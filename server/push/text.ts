// Care reminder title and body, shared by the web, FCM and Expo branches of POST /api/push/check-plants.
export type ReminderLang = "ru" | "en";

/** Body line for the number of plants needing care; noun and verb agree with the count. */
export function plantCountText(count: number, lang: ReminderLang = "ru"): string {
  if (lang === "en") {
    return count === 1 ? `${count} plant needs your attention 🌿` : `${count} plants need your attention 🌿`;
  }
  const mod10 = count % 10;
  const mod100 = count % 100;
  const singular = mod10 === 1 && mod100 !== 11;
  let word: string;
  if (singular) word = "растение";
  else if ([2, 3, 4].includes(mod10) && ![12, 13, 14].includes(mod100)) word = "растения";
  else word = "растений";
  return `${count} ${word} ${singular ? "ждёт" : "ждут"} вашего внимания 🌿`;
}

export function notifTitle(lang: ReminderLang = "ru"): string {
  return lang === "en" ? "Your plants need care 💚" : "Ваши цветочки ждут заботы 💚";
}
