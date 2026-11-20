//! Hardware detection for model recommendations and memory warnings.

use serde::Serialize;
use std::path::Path;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Hardware {
    pub os: String,
    pub os_version: String,
    pub arch: String,
    pub chip: String,
    pub apple_silicon: bool,
    pub gpu: String,
    pub total_ram_gb: f64,
    pub available_ram_gb: f64,
    pub free_disk_gb: f64,
    pub cpu_cores: usize,
    pub supported: bool,
    pub notes: Vec<String>,
}

pub fn total_ram_gb() -> f64 {
    let mut s = sysinfo::System::new();
    s.refresh_memory();
    s.total_memory() as f64 / 1_073_741_824.0
}

pub fn detect(data_dir: &Path) -> Hardware {
    let mut s = sysinfo::System::new();
    s.refresh_memory();
    let chip = std::process::Command::new("/usr/sbin/sysctl")
        .args(["-n", "machdep.cpu.brand_string"])
        .output()
        .ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default();
    let arch = std::env::consts::ARCH.to_string();
    let apple_silicon = cfg!(target_os = "macos") && arch == "aarch64";
    let total = s.total_memory() as f64 / 1_073_741_824.0;
    let mut notes = Vec::new();
    if !cfg!(target_os = "macos") {
        notes.push("Grain's audio capture currently supports macOS only.".into());
    } else if !apple_silicon {
        notes.push("Intel Macs run models on the CPU only and will be much slower.".into());
    }
    if total < 8.0 {
        notes.push("Less than 8 GB of memory: use the smallest models.".into());
    }
    Hardware {
        os: sysinfo::System::name().unwrap_or_else(|| std::env::consts::OS.into()),
        os_version: sysinfo::System::os_version().unwrap_or_default(),
        chip,
        gpu: if apple_silicon { "Apple GPU (Metal)".into() } else { "CPU only".into() },
        apple_silicon,
        total_ram_gb: total,
        available_ram_gb: s.available_memory() as f64 / 1_073_741_824.0,
        free_disk_gb: crate::models::free_space(data_dir).unwrap_or(0) as f64 / 1e9,
        cpu_cores: std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1),
        supported: cfg!(target_os = "macos"),
        notes,
        arch,
    }
}
