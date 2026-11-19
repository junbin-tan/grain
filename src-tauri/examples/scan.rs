// Dev probe: list models Grain finds on this Mac (other apps' folders). cargo run --release --example scan
fn main() {
    let t = std::time::Instant::now();
    let found = grain_lib::local::scan(&[], std::path::Path::new("/nonexistent"));
    for f in &found {
        println!("{:<34} {:<8} {:>6} MB  {:<38} {}", f.model_id.clone().or(f.name.clone()).unwrap_or_default(), f.quant.clone().or(f.role.clone()).unwrap_or_default(), f.size / 1_000_000, f.source, f.arch.clone().unwrap_or_default());
    }
    println!("{} found in {:.2}s", found.len(), t.elapsed().as_secs_f64());
}
