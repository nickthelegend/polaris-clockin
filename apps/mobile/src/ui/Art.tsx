// Abstract hero art drawn in SVG (no generated imagery): glowing discs in the
// brand's lime and purple, echoing the coins of the web app's onboarding.
import React from "react";
import Svg, { Circle, Defs, Ellipse, G, RadialGradient, Stop, LinearGradient, Rect } from "react-native-svg";

export function Coins({ size = 320, variant = 0 }: { size?: number; variant?: number }) {
  const layouts = [
    [
      { x: 0.68, y: 0.3, r: 0.2, a: "#d6ff8a", b: "#5fbf1f" },
      { x: 0.32, y: 0.58, r: 0.26, a: "#c7a6ff", b: "#5a1fd6" },
      { x: 0.76, y: 0.74, r: 0.1, a: "#ff8a95", b: "#b5122f" },
    ],
    [
      { x: 0.5, y: 0.45, r: 0.3, a: "#d6ff8a", b: "#4ea814" },
      { x: 0.2, y: 0.2, r: 0.08, a: "#c7a6ff", b: "#5a1fd6" },
      { x: 0.82, y: 0.78, r: 0.12, a: "#c7a6ff", b: "#5a1fd6" },
    ],
    [
      { x: 0.3, y: 0.38, r: 0.16, a: "#c7a6ff", b: "#5a1fd6" },
      { x: 0.7, y: 0.5, r: 0.22, a: "#c7a6ff", b: "#5a1fd6" },
      { x: 0.5, y: 0.2, r: 0.04, a: "#d6ff8a", b: "#5fbf1f" },
    ],
  ][variant % 3];
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Defs>
        {layouts.map((c, i) => (
          <RadialGradient key={i} id={`g${i}`} cx="35%" cy="30%" r="75%">
            <Stop offset="0" stopColor="#ffffff" stopOpacity="0.9" />
            <Stop offset="0.18" stopColor={c.a} stopOpacity="1" />
            <Stop offset="1" stopColor={c.b} stopOpacity="1" />
          </RadialGradient>
        ))}
        {layouts.map((c, i) => (
          <RadialGradient key={`h${i}`} id={`h${i}`} cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={c.a} stopOpacity="0.45" />
            <Stop offset="1" stopColor={c.a} stopOpacity="0" />
          </RadialGradient>
        ))}
      </Defs>
      {layouts.map((c, i) => (
        <G key={i}>
          <Circle cx={c.x * 100} cy={c.y * 100} r={c.r * 190} fill={`url(#h${i})`} />
          <Ellipse cx={c.x * 100} cy={c.y * 100 + c.r * 12} rx={c.r * 100} ry={c.r * 100} fill={c.b} opacity={0.9} />
          <Circle cx={c.x * 100} cy={c.y * 100} r={c.r * 100} fill={`url(#g${i})`} />
          <Circle cx={c.x * 100} cy={c.y * 100} r={c.r * 72} fill="none" stroke="#ffffff" strokeOpacity={0.25} strokeWidth={0.6} />
        </G>
      ))}
    </Svg>
  );
}

/** A faint square grid that fades out: the backdrop behind balances. */
export function Grid({ width, height }: { width: number; height: number }) {
  const cells = [];
  const step = 24;
  for (let x = 0; x <= width; x += step) cells.push(<Rect key={`x${x}`} x={x} y={0} width={1} height={height} fill="#0f1011" opacity={0.06} />);
  for (let y = 0; y <= height; y += step) cells.push(<Rect key={`y${y}`} x={0} y={y} width={width} height={1} fill="#0f1011" opacity={0.06} />);
  return (
    <Svg width={width} height={height} style={{ position: "absolute" }}>
      {cells}
    </Svg>
  );
}

export function StreakRing({ days, size = 64 }: { days: number; size?: number }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  const frac = Math.min(days, 7) / 7;
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64">
      <Defs>
        <LinearGradient id="sr" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#d6ff8a" />
          <Stop offset="1" stopColor="#5fbf1f" />
        </LinearGradient>
      </Defs>
      <Circle cx={32} cy={32} r={r} stroke="#2c2d30" strokeWidth={6} fill="none" />
      <Circle
        cx={32}
        cy={32}
        r={r}
        stroke="url(#sr)"
        strokeWidth={6}
        fill="none"
        strokeLinecap="round"
        strokeDasharray={`${c * frac} ${c}`}
        transform="rotate(-90 32 32)"
      />
    </Svg>
  );
}
