//! Audio processing: reading captured PCM, choosing chunk boundaries at pauses,
//! silence gating, WAV export, and mic/system echo de-duplication.
//!
//! Captured tracks are raw 16 kHz mono s16le (`mic.pcm`, `system.pcm`), written
//! by the capture helper. Raw PCM needs no header, so a file cut short by a crash
//! is still fully readable.

use anyhow::Result;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

pub const RATE: usize = 16_000;
const FRAME: usize = RATE * 30 / 1000; // 30 ms

pub fn pcm_samples(path: &Path) -> usize {
    std::fs::metadata(path).map(|m| (m.len() / 2) as usize).unwrap_or(0)
}

/// Read samples [from, to) as f32 in [-1, 1].
pub fn read_pcm(path: &Path, from: usize, to: usize) -> Result<Vec<f32>> {
    let mut f = std::fs::File::open(path)?;
    f.seek(SeekFrom::Start((from * 2) as u64))?;
    let mut buf = vec![0u8; to.saturating_sub(from) * 2];
    let n = read_full(&mut f, &mut buf)?;
    buf.truncate(n - n % 2);
    Ok(buf.as_chunks::<2>().0.iter().map(|b| i16::from_le_bytes([b[0], b[1]]) as f32 / 32768.0).collect())
}

fn read_full(f: &mut std::fs::File, buf: &mut [u8]) -> Result<usize> {
    let mut n = 0;
    while n < buf.len() {
        let k = f.read(&mut buf[n..])?;
        if k == 0 {
            break;
        }
        n += k;
    }
    Ok(n)
}

fn frame_rms(pcm: &[f32]) -> Vec<f32> {
    pcm.chunks(FRAME).map(|c| (c.iter().map(|x| x * x).sum::<f32>() / c.len().max(1) as f32).sqrt()).collect()
}

/// Absolute RMS floor below which a frame counts as silence (~ -46 dBFS).
const SILENCE_RMS: f32 = 0.005;

fn threshold(rms: &[f32]) -> f32 {
    // Adaptive: a bit above the quiet end of this window, never below the absolute floor.
    let mut v: Vec<f32> = rms.to_vec();
    v.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let p10 = v.get(v.len() / 10).copied().unwrap_or(0.0);
    (p10 * 2.5).max(SILENCE_RMS).min(0.05)
}

/// Seconds of audio that look like speech (frames clearly above the noise floor).
pub fn speech_seconds(pcm: &[f32]) -> f32 {
    let rms = frame_rms(pcm);
    let th = threshold(&rms).max(0.01);
    rms.iter().filter(|r| **r > th).count() as f32 * FRAME as f32 / RATE as f32
}

fn db(x: f32) -> f32 {
    20.0 * x.max(1e-5).log10()
}

fn corr(a: &[f32], b: &[f32]) -> f32 {
    let n = a.len().min(b.len()) as f32;
    let (ma, mb) = (a.iter().sum::<f32>() / n, b.iter().sum::<f32>() / n);
    let (mut ab, mut aa, mut bb) = (0.0, 0.0, 0.0);
    for (x, y) in a.iter().zip(b) {
        ab += (x - ma) * (y - mb);
        aa += (x - ma) * (x - ma);
        bb += (y - mb) * (y - mb);
    }
    if aa < 1e-6 || bb < 1e-6 { 0.0 } else { ab / (aa * bb).sqrt() }
}

/// Silence the parts of a mic chunk that are only the call coming back through the
/// speakers, so they are not transcribed as "Me". Works on loudness envelopes, so it
/// does not care what language is spoken or how differently the two tracks transcribe.
/// Measured on real recordings: speaker echo sits ~15–20 dB below the system track
/// and follows it closely (envelope correlation ~0.9); the user's own voice does not.
/// With headphones there is no echo and nothing is removed.
pub fn suppress_echo(mic: &mut [f32], system: &[f32]) {
    const MAX_LAG: isize = 20; // ±600 ms: the two capture paths are not sample-aligned
    const WIN: usize = 33; // ~1 s
    const ACTIVE_DB: f32 = -45.0;
    const MARGIN_DB: f32 = 10.0; // echo peaks reach ~6 dB above its typical level
    let floor = |x: f32| db(x).max(-60.0); // so silence padding cannot dominate the statistics
    let lm: Vec<f32> = frame_rms(mic).into_iter().map(floor).collect();
    let n = lm.len();
    let mut ls: Vec<f32> = frame_rms(system).into_iter().map(floor).collect();
    ls.resize(n, -60.0); // live: the system file may be a little behind
    let shifted = |lag: isize| -> Vec<f32> { (0..n as isize).map(|i| usize::try_from(i - lag).ok().and_then(|j| ls.get(j)).copied().unwrap_or(-60.0)).collect() };
    // ~1 s windows where the system track is talking, with how closely the mic follows it.
    // Judged per window so the user talking over the call does not hide the echo elsewhere.
    let windows = |s: &[f32]| -> Vec<(usize, f32)> {
        (0..n / WIN)
            .map(|w| w * WIN)
            .filter(|&a| s[a..a + WIN].iter().filter(|x| **x > ACTIVE_DB).count() > WIN / 2)
            .map(|a| (a, corr(&lm[a..a + WIN], &s[a..a + WIN])))
            .collect()
    };
    let median = |mut v: Vec<f32>| -> Option<f32> {
        v.sort_by(f32::total_cmp);
        v.get(v.len() / 2).copied()
    };
    let best = (-MAX_LAG..=MAX_LAG).filter_map(|l| median(windows(&shifted(l)).into_iter().map(|w| w.1).collect()).map(|m| (l, m))).max_by(|a, b| a.1.total_cmp(&b.1));
    let Some((lag, score)) = best else { return };
    if score < 0.6 {
        return; // the mic does not follow the system track (e.g. headphones): no echo
    }
    // Expected echo level at each mic frame: loudest recent system frame (room reverb
    // keeps the echo going ~200 ms after the source).
    let s = shifted(lag);
    let echo: Vec<f32> = (0..n).map(|i| s[i.saturating_sub(7)..(i + 3).min(n)].iter().copied().fold(-60.0, f32::max)).collect();
    // Echo gain, learnt only from windows that are clearly echo.
    let diffs = windows(&s).into_iter().filter(|w| w.1 >= 0.6).flat_map(|(a, _)| a..a + WIN).filter(|&i| echo[i] > ACTIVE_DB).map(|i| lm[i] - echo[i]).collect();
    let Some(gain) = median(diffs) else { return };
    let own: Vec<bool> = (0..n).map(|i| lm[i] > echo[i] + gain + MARGIN_DB).collect();
    // Keep runs of own voice >= 150 ms, padded by 150 ms so word edges survive.
    let mut keep = vec![false; n];
    let mut i = 0;
    while i < n {
        let j = (i..n).find(|&j| !own[j]).unwrap_or(n);
        if j - i >= 5 {
            keep[i.saturating_sub(5)..(j + 5).min(n)].iter_mut().for_each(|k| *k = true);
        }
        i = j + 1;
    }
    for (f, k) in mic.chunks_mut(FRAME).zip(&keep) {
        if !k {
            f.fill(0.0);
        }
    }
}

/// Choose where to end a chunk that starts at pcm[0]: the middle of the latest
/// pause (>= 300 ms of quiet frames) between `min` and `max` samples. Returns
/// None if there is no pause in range.
// shortcut: energy-based pause detection; Silero VAD (available in transcribe.cpp) would be more robust in noisy rooms.
pub fn find_cut(pcm: &[f32], min: usize, max: usize) -> Option<usize> {
    let max = max.min(pcm.len());
    if max <= min {
        return None;
    }
    let rms = frame_rms(&pcm[..max]);
    let th = threshold(&rms);
    let need = 10; // 300 ms
    let long = 34; // ~1 s: a turn boundary; cut at the first one after 2 s
    let lo = min / FRAME;
    let lo_turn = (2 * RATE / FRAME).min(lo);
    let mut run_t = 0usize;
    for (i, r) in rms.iter().enumerate() {
        if *r <= th {
            run_t += 1;
            continue;
        }
        if run_t >= long && i - run_t / 2 >= lo_turn {
            return Some((i - run_t / 2) * FRAME);
        }
        run_t = 0;
    }
    let mut run = 0usize;
    let mut best: Option<usize> = None;
    for (i, r) in rms.iter().enumerate() {
        if *r <= th {
            run += 1;
        } else {
            if run >= need && i - run / 2 >= lo {
                best = Some((i - run / 2) * FRAME);
            }
            run = 0;
        }
    }
    if run >= need && rms.len() - run / 2 >= lo {
        best = Some((rms.len() - run / 2) * FRAME);
    }
    best
}

/// Plan chunk boundaries for a whole track (post-meeting / re-transcription).
pub fn plan_chunks(pcm: &[f32], target_max: usize) -> Vec<(usize, usize)> {
    let mut out = Vec::new();
    let mut start = 0;
    let min = 5 * RATE;
    while start < pcm.len() {
        let rest = pcm.len() - start;
        if rest <= target_max {
            out.push((start, pcm.len()));
            break;
        }
        let cut = find_cut(&pcm[start..], min, target_max).unwrap_or(target_max);
        out.push((start, start + cut));
        start += cut;
    }
    out
}

pub fn write_wav(path: &Path, tracks: &[Vec<f32>]) -> Result<()> {
    let spec = hound::WavSpec { channels: 1, sample_rate: RATE as u32, bits_per_sample: 16, sample_format: hound::SampleFormat::Int };
    let mut w = hound::WavWriter::create(path, spec)?;
    let len = tracks.iter().map(|t| t.len()).max().unwrap_or(0);
    for i in 0..len {
        let s: f32 = tracks.iter().map(|t| t.get(i).copied().unwrap_or(0.0)).sum::<f32>();
        w.write_sample((s.clamp(-1.0, 1.0) * 32767.0) as i16)?;
    }
    w.finalize()?;
    Ok(())
}

fn tokens(text: &str) -> std::collections::HashSet<String> {
    let mut out = std::collections::HashSet::new();
    let mut word = String::new();
    for c in text.to_lowercase().chars() {
        if c.is_alphanumeric() && (c as u32) < 0x2E80 {
            word.push(c);
        } else {
            if !word.is_empty() {
                out.insert(std::mem::take(&mut word));
            }
            if c.is_alphanumeric() {
                out.insert(c.to_string()); // CJK: one token per character
            }
        }
    }
    if !word.is_empty() {
        out.insert(word);
    }
    out
}

pub fn similarity(a: &str, b: &str) -> f32 {
    let (ta, tb) = (tokens(a), tokens(b));
    if ta.is_empty() || tb.is_empty() {
        return 0.0;
    }
    let inter = ta.intersection(&tb).count() as f32;
    inter / ta.len().min(tb.len()) as f32
}

/// When the user is on speakers, the microphone also hears the remote side. Find
/// mic segments that repeat an overlapping system-audio segment so they can be dropped.
pub fn echo_duplicates(segs: &[crate::db::Segment]) -> Vec<i64> {
    let system: Vec<_> = segs.iter().filter(|s| s.source == "system").collect();
    segs.iter()
        .filter(|m| m.source == "mic")
        .filter(|m| {
            system.iter().any(|s| s.start_ms <= m.end_ms + 2000 && s.end_ms + 2000 >= m.start_ms && similarity(&m.text, &s.text) >= 0.6)
        })
        .map(|m| m.id)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tone(secs: f32, amp: f32) -> Vec<f32> {
        (0..(secs * RATE as f32) as usize).map(|i| amp * ((i as f32) * 0.07).sin()).collect()
    }

    #[test]
    fn cut_lands_in_the_pause() {
        let mut pcm = tone(8.0, 0.3);
        pcm.extend(vec![0.0; RATE]); // 1 s pause at 8..9 s
        pcm.extend(tone(8.0, 0.3));
        let cut = find_cut(&pcm, 5 * RATE, 15 * RATE).unwrap();
        assert!(cut > 8 * RATE && cut < 9 * RATE, "cut at {cut}");
        assert!(find_cut(&tone(10.0, 0.3), RATE, 9 * RATE).is_none());
        // A 1.5 s pause after 3 s is a turn boundary: preferred over a later short pause.
        let mut t = tone(3.0, 0.3);
        t.extend(vec![0.0; RATE * 3 / 2]);
        t.extend(tone(5.0, 0.3));
        t.extend(vec![0.0; RATE / 2]);
        t.extend(tone(5.0, 0.3));
        let cut = find_cut(&t, 5 * RATE, 20 * RATE).unwrap();
        assert!(cut > 3 * RATE && cut < RATE * 9 / 2, "turn cut at {cut}");
    }

    #[test]
    fn plan_covers_everything_without_overlap() {
        let mut pcm = Vec::new();
        for _ in 0..10 {
            pcm.extend(tone(7.0, 0.2));
            pcm.extend(vec![0.0; RATE / 2]);
        }
        let plan = plan_chunks(&pcm, 30 * RATE);
        assert_eq!(plan.first().unwrap().0, 0);
        assert_eq!(plan.last().unwrap().1, pcm.len());
        for w in plan.windows(2) {
            assert_eq!(w[0].1, w[1].0);
        }
        assert!(plan.iter().all(|(a, b)| b - a <= 30 * RATE));
    }

    #[test]
    fn silence_has_no_speech() {
        assert!(speech_seconds(&vec![0.0; RATE * 5]) < 0.1);
        assert!(speech_seconds(&tone(3.0, 0.2)) > 2.5);
    }

    #[test]
    fn speaker_echo_is_silenced_own_voice_kept() {
        // System: syllable-like bursts (varying loudness) for 6 s, then quiet for 3 s.
        let mut system = Vec::new();
        for k in 0..30 {
            system.extend(tone(0.12, 0.05 + 0.04 * (k % 4) as f32));
            system.extend(vec![0.0; RATE / 12]);
        }
        system.extend(vec![0.0; RATE * 3]);
        // Mic: the same audio 60 ms later at -18 dB, plus the user speaking at 7–8 s.
        let delay = RATE * 6 / 100;
        let mut mic: Vec<f32> = (0..system.len()).map(|i| if i >= delay { system[i - delay] * 0.125 } else { 0.0 }).collect();
        let user = tone(1.0, 0.1);
        mic[7 * RATE..8 * RATE].copy_from_slice(&user);
        let headphones = { let mut m = vec![0.0; system.len()]; m[7 * RATE..8 * RATE].copy_from_slice(&user); m };
        suppress_echo(&mut mic, &system);
        assert!(speech_seconds(&mic[..6 * RATE]) < 0.3, "echo left: {}", speech_seconds(&mic[..6 * RATE]));
        assert!(speech_seconds(&mic[7 * RATE..8 * RATE]) > 0.9);
        let mut h = headphones.clone();
        suppress_echo(&mut h, &system);
        assert_eq!(h, headphones);
    }

    #[test]
    fn echo_detection() {
        use crate::db::Segment;
        let s = |id, src: &str, t: &str, a| Segment { id, meeting_id: "m".into(), source: src.into(), speaker: None, start_ms: a, end_ms: a + 3000, text: t.into(), original_text: t.into(), language: None, model_id: "x".into(), status: "final".into(), edited: false };
        let segs = vec![
            s(1, "system", "We will ship the beta on Friday.", 1000),
            s(2, "mic", "we will ship the beta on friday", 1200),
            s(3, "mic", "Sounds good, I'll write the notes.", 5000),
            s(4, "system", "我们下周发布", 9000),
            s(5, "mic", "我们下周发布", 9100),
        ];
        assert_eq!(echo_duplicates(&segs), vec![2, 5]);
    }

    #[test]
    fn pcm_roundtrip_tolerates_truncated_file() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("t.pcm");
        let mut bytes: Vec<u8> = [1000i16, -1000, 32767].iter().flat_map(|s| s.to_le_bytes()).collect();
        bytes.push(7); // half a sample, as after a crash mid-write
        std::fs::write(&p, bytes).unwrap();
        assert_eq!(pcm_samples(&p), 3);
        let v = read_pcm(&p, 0, 10).unwrap();
        assert_eq!(v.len(), 3);
        assert!((v[0] - 1000.0 / 32768.0).abs() < 1e-6);
    }
}
