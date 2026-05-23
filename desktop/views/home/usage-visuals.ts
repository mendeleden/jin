const USAGE_COLORS = [
  "#89d4a1",
  "#89b4ff",
  "#f0c46d",
  "#ff8f84",
  "#a8d8ea",
  "#d6b3ff",
] as const;

const USAGE_COLOR_CLASSES = [
  "bg-[#89d4a1]",
  "bg-[#89b4ff]",
  "bg-[#f0c46d]",
  "bg-[#ff8f84]",
  "bg-[#a8d8ea]",
  "bg-[#d6b3ff]",
] as const;

const USAGE_SIZE_BUCKET_STEP = 5;
const USAGE_SIZE_BUCKET_MAX = 100;
const USAGE_SIZE_SPECIAL_BUCKETS = new Set([2, 3, 7, 12]);
const USAGE_WIDTH_CLASSES = {
  0: "w-[0%]",
  3: "w-[3%]",
  5: "w-[5%]",
  7: "w-[7%]",
  10: "w-[10%]",
  15: "w-[15%]",
  20: "w-[20%]",
  25: "w-[25%]",
  30: "w-[30%]",
  35: "w-[35%]",
  40: "w-[40%]",
  45: "w-[45%]",
  50: "w-[50%]",
  55: "w-[55%]",
  60: "w-[60%]",
  65: "w-[65%]",
  70: "w-[70%]",
  75: "w-[75%]",
  80: "w-[80%]",
  85: "w-[85%]",
  90: "w-[90%]",
  95: "w-[95%]",
  100: "w-[100%]",
} as const;

const USAGE_HEIGHT_CLASSES = {
  0: "h-[0%]",
  2: "h-[2%]",
  5: "h-[5%]",
  10: "h-[10%]",
  12: "h-[12%]",
  15: "h-[15%]",
  20: "h-[20%]",
  25: "h-[25%]",
  30: "h-[30%]",
  35: "h-[35%]",
  40: "h-[40%]",
  45: "h-[45%]",
  50: "h-[50%]",
  55: "h-[55%]",
  60: "h-[60%]",
  65: "h-[65%]",
  70: "h-[70%]",
  75: "h-[75%]",
  80: "h-[80%]",
  85: "h-[85%]",
  90: "h-[90%]",
  95: "h-[95%]",
  100: "h-[100%]",
} as const;

type UsageWidthBucket = keyof typeof USAGE_WIDTH_CLASSES;
type UsageHeightBucket = keyof typeof USAGE_HEIGHT_CLASSES;

export function usageColorClass(index: number): string {
  return USAGE_COLOR_CLASSES[index % USAGE_COLOR_CLASSES.length] ?? USAGE_COLOR_CLASSES[0];
}

export function usageColorClassForColor(color?: string): string {
  const normalizedColor = color?.toLowerCase();
  const index = USAGE_COLORS.findIndex(
    (candidate) => candidate.toLowerCase() === normalizedColor,
  );

  return usageColorClass(index >= 0 ? index : 0);
}

export function usageColorHex(index: number): string {
  return USAGE_COLORS[index % USAGE_COLORS.length] ?? USAGE_COLORS[0];
}

export function usageWidthClass(
  value: number,
  maxValue: number,
  minPercent: number,
): string {
  return USAGE_WIDTH_CLASSES[
    usageSizeBucket(value, maxValue, minPercent) as UsageWidthBucket
  ];
}

export function usageHeightClass(
  value: number,
  maxValue: number,
  minPercent: number,
): string {
  return USAGE_HEIGHT_CLASSES[
    usageSizeBucket(value, maxValue, minPercent) as UsageHeightBucket
  ];
}

function usageSizeBucket(
  value: number,
  maxValue: number,
  minPercent: number,
): number {
  const percent =
    Number.isFinite(value) && Number.isFinite(maxValue) && maxValue > 0
      ? (Math.max(0, value) / maxValue) * 100
      : 0;
  const minimum = clampUsagePercent(minPercent);
  const bucket =
    percent <= minimum
      ? supportedUsageMinimumBucket(minimum)
      : ceilUsageBucket(percent);

  return bucket;
}

function clampUsagePercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(Math.max(0, Math.round(value)), USAGE_SIZE_BUCKET_MAX);
}

function supportedUsageMinimumBucket(value: number): number {
  if (value === 0 || USAGE_SIZE_SPECIAL_BUCKETS.has(value)) {
    return value;
  }

  return ceilUsageBucket(value);
}

function ceilUsageBucket(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }

  return Math.min(
    USAGE_SIZE_BUCKET_MAX,
    Math.ceil(value / USAGE_SIZE_BUCKET_STEP) * USAGE_SIZE_BUCKET_STEP,
  );
}
