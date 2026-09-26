# @polaris/brand

The Polaris mark: a four-point star with a green rim and a lime face.

```tsx
import { PolarisMark } from "@polaris/brand";

<PolarisMark className="h-7 w-auto" />             // full colour
<PolarisMark mono className="text-[#111] h-5" />   // one colour
<PolarisMark title="" />                           // decorative, next to the word
```

Next.js apps add `transpilePackages: ["@polaris/brand"]` to `next.config`.

## Assets

| File | Use |
|---|---|
| `assets/mark.svg`, `assets/mark-mono.svg` | The vector mark (full colour, and `currentColor`) |
| `assets/mark-{16,32,48,256,512,1024}.png` | The mark on transparent |
| `assets/favicon.ico` | 16, 32 and 48 px |
| `assets/app-icon-{192,512}.png`, `assets/app-icon-maskable-512.png`, `assets/apple-touch-icon.png` | The lime star on ink, for PWA manifests and home screens |
| `assets/mark-source.png` | The original artwork the vector was fitted to |

The vector is fitted to `mark-source.png`, one cubic Bezier per edge (99.1% outer
and 98.7% inner pixel overlap with the source).

**Wordmark:** the "Polaris" text logo is coming from the team. Until it lands,
apps set the word in their display face.
