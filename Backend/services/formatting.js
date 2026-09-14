// Shared display formatting for the admin PDF and emails. Dates use Asia/Kolkata.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || "");
  return match ? `${match[3]} ${MONTHS[Number(match[2]) - 1]} ${match[1]}` : value || "";
}

function formatDateTime(value) {
  const date = new Date(value);
  if (!value || !Number.isFinite(date.getTime())) return "";
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date).map(part => [part.type, part.value]));
  return `${parts.day} ${MONTHS[Number(parts.month) - 1]} ${parts.year}, ${parts.hour}:${parts.minute} IST`;
}

const phone = (code, number) => number ? `${code || ""} ${number}`.trim() : "";

module.exports = { formatDate, formatDateTime, phone };
