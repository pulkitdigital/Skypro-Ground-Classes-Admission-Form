import { useEffect, useState } from "react";
import { localDateString } from "./studentDetailsModel.js";

export default function useCurrentDate() {
  const [today, setToday] = useState(localDateString);
  useEffect(() => {
    let timer;
    const refresh = () => {
      clearTimeout(timer);
      setToday(localDateString());
      const now = new Date();
      const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      timer = setTimeout(refresh, midnight - now + 100);
    };
    refresh();
    window.addEventListener("focus", refresh);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("focus", refresh);
    };
  }, []);
  return today;
}
