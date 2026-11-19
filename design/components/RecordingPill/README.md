# RecordingPill

RecordingPill is the floating control shown while Grain is capturing a meeting.

- Contents: the `rec` dot, the word "Recording", a mono timer, a live waveform of 7 bars (the mark's count) whose active bar is `malt`, and a stop button.
- `paper-raised` with `line` edge and `shadow-raised`: it is the one element that floats.
- The dot pulses only when the user hasn't asked for reduced motion. `gr-rec--paused` greys the dot and changes the word to "Paused".
- It never says "Bot joined" or names the meeting app: Grain records without joining.
