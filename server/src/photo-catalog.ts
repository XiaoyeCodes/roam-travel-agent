import type { Photo, Stop } from "../../shared/types.js";

// Public Unsplash pages researched for the bundled Nanjing itinerary, 2026-10-15.
// Preserve source pages and photographers. Related views explicitly say what is pictured.
function photo(
  id: string,
  image: string,
  author: string,
  username: string,
  caption: string,
): Photo {
  const referral = "?utm_source=roam_travel&utm_medium=referral";
  return {
    id,
    url: `https://images.unsplash.com/${image}?auto=format&fit=crop&w=1200&q=80`,
    alt: caption,
    caption,
    photographer: author,
    profileUrl: `https://unsplash.com/@${username}${referral}`,
    photoUrl: `https://unsplash.com/photos/${id}${referral}`,
    source: "unsplash-curated",
  };
}
export const catalog = {
  tokyo: photo(
    "alY6_OpdwRQ",
    "photo-1542051841857-5f90071e7989",
    "Jezael Melgoza",
    "jezar",
    "东京涩谷夜景 · 目的地实景封面，来源页标注拍摄地",
  ),
  jiuzhaigou: photo(
    "zjpXSPxLQf0",
    "photo-1768276530399-778d3e7583ad",
    "Russ Lee",
    "gen0451021",
    "九寨沟老虎海 · 目的地实景封面，来源页标注拍摄地",
  ),
  street: photo(
    "olF6l74uGbQ",
    "photo-1776305251362-1b8235a364ba",
    "Alan W",
    "alanw",
    "南京灯笼街景 · 同城相关配图，未核实为老门东",
  ),
  forest: photo(
    "JD80olx55ac",
    "photo-1589259412081-f55ac792c16b",
    "Jennifer Chen",
    "jnnfrchn",
    "钟山片区林荫 · 相关风景，非美龄宫建筑实拍",
  ),
  river: photo(
    "m5iT983hB08",
    "photo-1773125507876-27fce50e44f3",
    "Yufeng Mao",
    "splike",
    "南京夜市纸伞 · 同城相关配图，非夫子庙建筑实拍",
  ),
  museum: photo(
    "0b62owM-8CA",
    "photo-1753957012011-080e80aaec21",
    "Terence Zheng",
    "terrycarnivoroua",
    "南京博物院馆藏 · 来源页标注拍摄地",
  ),
  dumplings: photo(
    "GZe_M6TUJ_k",
    "photo-1563245372-f21724e3856d",
    "SJ 📸",
    "uxsj_ph",
    "中式蒸笼点心 · 菜品意象，非推荐餐馆实拍",
  ),
  temple: photo(
    "qLB3lOrmecs",
    "photo-1768802870911-cc632775bb48",
    "Jeremy Huang",
    "plover37",
    "南京鸡鸣寺 · 来源页标注拍摄地",
  ),
  mausoleum: photo(
    "LHgbF0N0jHA",
    "photo-1588001255325-55a26430101c",
    "Calder Ou",
    "calderobb",
    "南京中山陵 · 来源页标注拍摄地",
  ),
  ming: photo(
    "-DfPL_Owy_8",
    "photo-1751057576536-8ea9a09beb45",
    "Joss Woodhead",
    "josswoodhead",
    "明孝陵红墙花影 · 来源页标注拍摄地",
  ),
  lake: photo(
    "XZJCB2iXzPQ",
    "photo-1768802870848-fa09edc32bc3",
    "Jeremy Huang",
    "plover37",
    "南京玄武湖 · 来源页标注拍摄地",
  ),
  wall: photo(
    "nsZVk5LwqxM",
    "photo-1711272779236-7c6e3f25a530",
    "Bo Peng",
    "micraow",
    "南京城墙眺望 · 相关取景，未标注具体城墙段",
  ),
};
// Destination covers are separate from stop photos; a city view must not be
// presented as a particular attraction. Source pages checked 2026-10-16.
export function destinationPhotos(destination: string): Photo[] {
  const city = destination.trim().replace(/市$/, "").toLowerCase();
  if (["南京", "nanjing"].includes(city))
    return [catalog.lake, catalog.mausoleum, catalog.temple];
  if (["东京", "tokyo", "東京都"].includes(city)) return [catalog.tokyo];
  if (["九寨沟", "九寨沟县", "jiuzhaigou"].includes(city))
    return [catalog.jiuzhaigou];
  return [];
}
export function curatedPhoto(
  destination: string,
  stop: Stop,
): Photo | undefined {
  if (!/南京|nanjing/i.test(destination)) return;
  if (
    stop.type === "food" &&
    /小笼|汤包|点心|包子|饺/.test(stop.name + stop.description)
  )
    return { ...catalog.dumplings };
  if (stop.type !== "attraction") return;
  if (/南京博物院/.test(stop.name)) return { ...catalog.museum };
  if (/老门东/.test(stop.name)) return { ...catalog.street };
  if (/鸡鸣寺/.test(stop.name)) return { ...catalog.temple };
  if (/明孝陵/.test(stop.name)) return { ...catalog.ming };
  if (/美龄宫/.test(stop.name)) return { ...catalog.forest };
  if (/夫子庙|秦淮/.test(stop.name)) return { ...catalog.river };
  if (/中山陵/.test(stop.name)) return { ...catalog.mausoleum };
  if (/玄武湖/.test(stop.name)) return { ...catalog.lake };
  if (/南京城墙|台城/.test(stop.name)) return { ...catalog.wall };
}
const aliases: [RegExp, string][] = [
  [/南京博物院/, "Nanjing Museum"],
  [/老门东/, "Laomendong Nanjing old street"],
  [/夫子庙|秦淮/, "Nanjing Fuzimiao Qinhuai river"],
  [/明孝陵/, "Ming Xiaoling Mausoleum Nanjing"],
  [/美龄宫/, "Meiling Palace Nanjing"],
  [/中山陵/, "Sun Yat sen Mausoleum Nanjing"],
  [/玄武湖/, "Xuanwu Lake Nanjing"],
  [/鸡鸣寺/, "Jiming Temple Nanjing"],
  [/南京城墙|台城/, "Nanjing city wall"],
];
export function photoQuery(destination: string, stop: Stop) {
  if (stop.photoQuery?.trim()) return stop.photoQuery.trim();
  if (stop.type === "food") {
    const text = stop.name + stop.description;
    if (/小笼|汤包/.test(text)) return "xiaolongbao soup dumplings";
    if (/面|粉丝/.test(text)) return "Chinese noodle soup";
    if (/鸭/.test(text)) return "Chinese duck dish";
    return `${destination} ${stop.name} food`;
  }
  return (
    (/南京|nanjing/i.test(destination) &&
      aliases.find(([pattern]) => pattern.test(stop.name))?.[1]) ||
    `${destination} ${stop.name}`
  );
}
