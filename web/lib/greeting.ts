export function greetingKey(hourIst: number): "morning" | "afternoon" | "evening" {
  if (hourIst < 12) return "morning";
  if (hourIst < 17) return "afternoon";
  return "evening";
}
