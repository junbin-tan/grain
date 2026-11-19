// Dev probe: print word timestamps for a WAV file. cargo run --release --example words -- model.gguf file.wav [lang]
fn main() {
    let a: Vec<String> = std::env::args().collect();
    let mut r = hound::WavReader::open(&a[2]).unwrap();
    let pcm: Vec<f32> = r.samples::<i16>().map(|s| s.unwrap() as f32 / 32768.0).collect();
    let m = transcribe_cpp::Model::load(&a[1]).unwrap();
    let mut s = m.session().unwrap();
    let opts = transcribe_cpp::RunOptions { language: a.get(3).cloned(), ..Default::default() };
    let t = s.run(&pcm, &opts).unwrap();
    println!("kind={:?} lang={:?}\ntext={}", t.timestamp_kind, t.language, t.text);
    for w in t.words.iter().take(40) { println!("{:>6}-{:>6} {:?}", w.t0_ms, w.t1_ms, w.text); }
    for g in &t.segments { println!("SEG {}-{} {:?}", g.t0_ms, g.t1_ms, g.text); }
}
