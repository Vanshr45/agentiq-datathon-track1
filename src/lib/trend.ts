// first half vs second half of the period, plus how noisy the daily values are
export function describeTrend(series: number[]) {
  if (series.length < 4) return "too few days in this range to describe a trend";
  const half = Math.floor(series.length / 2);
  const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
  const a = mean(series.slice(0, half)), b = mean(series.slice(half)), m = mean(series);
  const change = a ? (b - a) / a : 0;
  const sd = Math.sqrt(mean(series.map((v) => (v - m) ** 2)));
  const cv = m ? sd / m : 0;
  const shape = Math.abs(change) < 0.05
    ? (cv < 0.15 ? "held steady" : "showed no clear direction")
    : `${change > 0 ? "rose" : "fell"} about ${Math.round(Math.abs(change) * 100)}% between the first and second half of the period`;
  const noise = cv < 0.1 ? "with little day-to-day movement" : cv < 0.25 ? "with moderate day-to-day swings" : "with large day-to-day swings";
  return `${shape}, ${noise}`;
}
