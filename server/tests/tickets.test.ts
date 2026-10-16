import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  ticketQuerySchema,
  validateTicketDate,
  chinaToday,
  resolveAirports,
  parseRailResult,
  hasTicketForLeg,
} from "../src/tickets.js";
import { runTicketProcess, waitForTicket } from "../src/ticket-process.js";
import type { Evidence } from "../../shared/types.js";

test("ticket dates validate calendar, China midnight and inclusive railway presale window", () => {
  assert.equal(
    ticketQuerySchema.safeParse({
      origin: "上海",
      destination: "南京",
      date: "2026-02-30",
    }).success,
    false,
  );
  assert.equal(chinaToday(new Date("2026-10-15T16:05:00Z")), "2026-10-16");
  validateTicketDate("2026-10-30", "rail", "2026-10-16");
  assert.throws(
    () => validateTicketDate("2026-10-31", "rail", "2026-10-16"),
    /预售期/,
  );
  assert.throws(
    () => validateTicketDate("2026-10-15", "flight", "2026-10-16"),
    /今天/,
  );
});
test("airport lookup covers both city airports and rejects unknown city mappings", () => {
  assert.deepEqual(resolveAirports("上海市"), ["SHA", "PVG"]);
  assert.deepEqual(resolveAirports("pek"), ["PEK"]);
  assert.throws(() => resolveAirports("苏州"), /不会自动替换/);
});
const railResponse = (rows: unknown) => ({
  content: [{ type: "text", text: JSON.stringify(rows) }],
});
const train = {
  start_train_code: "G1",
  start_date: "2026-10-23",
  arrive_date: "2026-10-23",
  start_time: "08:00",
  arrive_time: "10:00",
  from_station: "上海",
  to_station: "南京",
  lishi: "02:00",
  prices: [{ seat_name: "二等座", num: "有" }],
};
test("rail adapter detects upstream textual errors and preserves missing fares", () => {
  assert.throws(
    () =>
      parseRailResult(
        { content: [{ type: "text", text: "Error: get cookie failed" }] },
        train.start_date,
      ),
    /失败/,
  );
  assert.throws(
    () => parseRailResult(railResponse([train]), "2026-10-24"),
    /不匹配/,
  );
  assert.equal(
    parseRailResult(railResponse([train]), train.start_date)[0].price,
    null,
  );
  assert.deepEqual(parseRailResult(railResponse([]), train.start_date), []);
});
test("outbound tickets, empty results and flight-only results cannot verify a return train leg", () => {
  const item: Evidence = {
    id: "a",
    queriedAt: "now",
    tool: "search_train_tickets",
    source: "test",
    status: "live",
    data: {
      origin: "上海",
      destination: "南京",
      date: "2026-10-23",
      results: [train],
    },
  };
  assert.equal(
    hasTicketForLeg([item], "上海", "南京", "2026-10-23", "train"),
    true,
  );
  assert.equal(
    hasTicketForLeg([item], "南京", "上海", "2026-10-25", "train"),
    false,
  );
  assert.equal(
    hasTicketForLeg(
      [{ ...item, tool: "search_flights" }],
      "上海",
      "南京",
      "2026-10-23",
      "train",
    ),
    false,
  );
  assert.equal(
    hasTicketForLeg(
      [{ ...item, data: { ...(item.data as object), results: [] } }],
      "上海",
      "南京",
      "2026-10-23",
      "train",
    ),
    false,
  );
});
test("query subprocess consumes JSON input and stops on cancellation or timeout", async () => {
  const output = await runTicketProcess(
    process.execPath,
    [
      "-e",
      "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>console.log(JSON.stringify({echo:JSON.parse(s)})))",
    ],
    { cwd: path.resolve("."), input: { city: "上海" } },
  );
  assert.deepEqual(JSON.parse(output), { echo: { city: "上海" } });
  await assert.rejects(
    runTicketProcess(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
      cwd: path.resolve("."),
      timeout: 120,
    }),
    /超时/,
  );
  const controller = new AbortController();
  const running = runTicketProcess(
    process.execPath,
    ["-e", "setInterval(()=>{},1000)"],
    { cwd: path.resolve("."), signal: controller.signal },
  );
  controller.abort();
  await assert.rejects(running, /取消/);
});
test("canceling a waiting query does not cancel shared initialization", async () => {
  let resolve!: (value: string) => void;
  const shared = new Promise<string>((done) => {
    resolve = done;
  });
  const controller = new AbortController();
  const waiting = waitForTicket(shared, controller.signal);
  controller.abort();
  await assert.rejects(waiting, /取消/);
  resolve("ready");
  assert.equal(await shared, "ready");
});
