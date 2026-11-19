# VerifyBadge

VerifyBadge shows what the checking step concluded about a claim, or where processing happened.

- `gr-verify--found` (sprout): the claim was found in the transcript. Label: "Found in transcript".
- `gr-verify--missing` (clay): nothing in the transcript supports it. Label: "Not found in transcript". Pair it with the claim struck through (`gr-action__struck`) or removed.
- `gr-verify--local` (neutral): on-device status, e.g. "On this Mac · offline". Use with the `lock` icon.
- Always icon + words. Never colour alone.
