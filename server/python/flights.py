"""Read-only fast-flights adapter. JSON on stdin/stdout; no paid integrations.

The upstream 3.1.0 parser only reads the 'other flights' group and crashes on
offers without a price. Keep both result groups and preserve unknown prices.
"""
import json
import math
import os
import sys
import time
from datetime import datetime


def at(value, *indices):
    for index in indices:
        if not isinstance(value, list) or index >= len(value):
            return None
        value = value[index]
    return value


def local_time(date, time):
    if not isinstance(date, list) or len(date) != 3 or not isinstance(time, list):
        raise ValueError("Missing flight date/time")
    # Google omits zero minutes, e.g. [15] means 15:00.
    hour, minute = (time + [None, None])[:2]
    value = datetime(*date, hour or 0, minute or 0)
    return value.isoformat(timespec="minutes")


class UpstreamUnavailable(ValueError):
    pass


def extract_payload(js):
    if 'errorHasStatus: true' in js:
        raise UpstreamUnavailable("Google Flights 暂时无法完成该查询，请稍后重试")
    try:
        # Decode just the JSON value; callback metadata is JavaScript, not JSON.
        payload, _ = json.JSONDecoder().raw_decode(js.split('data:', 1)[1].lstrip())
        return payload
    except (ValueError, IndexError):
        raise ValueError("Google Flights 数据格式已变化，解析失败") from None


def parse_payload(payload, origin, destination, date, max_stops):
    if not isinstance(payload, list) or len(payload) < 4:
        raise ValueError("Google Flights 返回结构已变化，无法核验航班")
    results, seen, skipped, group_found = [], set(), 0, False
    for index in (2, 3):
        group = payload[index]
        if group is None:
            continue
        if not isinstance(group, list) or not group:
            raise ValueError("Google Flights 航班分组格式已变化")
        rows = group[0]
        if rows is None:
            group_found = True
            continue
        if not isinstance(rows, list):
            raise ValueError("Google Flights 航班列表格式已变化")
        group_found = True
        for row in rows:
            try:
                flight = row[0]
                raw_segments = flight[2]
                if not raw_segments or len(raw_segments) - 1 > max_stops:
                    continue
                segments = []
                for segment in raw_segments:
                    number = at(segment, 22)
                    segments.append({
                        "flightNumber": f"{number[0]}{number[1]}" if number and len(number) > 1 else None,
                        "airline": at(number, 3),
                        "from": segment[3], "fromName": segment[4],
                        "to": segment[6], "toName": segment[5],
                        "departure": local_time(segment[20], segment[8]),
                        "arrival": local_time(segment[21], segment[10]),
                        "durationMinutes": segment[11],
                    })
                first, last = segments[0], segments[-1]
                if first['from'] != origin or last['to'] != destination or first['departure'][:10] != date:
                    raise ValueError("Flight does not match query")
                price = at(row, 1, 0, 1)
                if isinstance(price, bool) or not isinstance(price, (int, float)) or not math.isfinite(price) or price <= 0:
                    price = None
                key = tuple((s['flightNumber'], s['from'], s['to'], s['departure']) for s in segments)
                if key in seen:
                    continue
                seen.add(key)
                results.append({
                    "name": " / ".join(s['flightNumber'] or "航班号未提供" for s in segments),
                    "airlines": flight[1], "from": first['fromName'], "to": last['toName'],
                    "departure": first['departure'], "arrival": last['arrival'],
                    "durationMinutes": flight[9], "stops": len(segments) - 1,
                    "price": price, "priceBasis": "all_passengers", "currency": "CNY",
                    "availability": "余位数量未提供", "segments": segments,
                })
            except (TypeError, IndexError, ValueError):
                skipped += 1
    if not group_found or (skipped and not results):
        raise ValueError("未能解析可核验的航班，不能据此判断无航班")
    return results, skipped


def search(args):
    from fast_flights import FlightQuery, Passengers, create_query
    from fast_flights.fetcher import fetch_flights_html
    from fast_flights.integrations.base import FetchIntegration
    from primp import Client
    from selectolax.lexbor import LexborHTMLParser
    query = create_query(
        flights=[FlightQuery(date=args['date'], from_airport=args['fromAirport'],
                             to_airport=args['toAirport'], max_stops=args['maxStops'])],
        seat="economy", trip="one-way", passengers=Passengers(adults=args['passengers']),
        language="zh-CN", currency="CNY",
    )
    proxy = os.environ.get('HTTPS_PROXY') or os.environ.get('https_proxy')
    class SearchPage(FetchIntegration):
        # Use the actual search URL exposed by fast-flights, not its landing page.
        def __init__(self):
            self.client = Client(impersonate="chrome_145", impersonate_os="macos",
                                 referer=True, proxy=proxy, cookie_store=True, timeout=12)

        def fetch_html(self, q, /):
            response = self.client.get(q.url())
            if response.status_code != 200:
                raise ValueError(f"Google Flights 返回 HTTP {response.status_code}，请稍后重试")
            return response.text

    fetcher = SearchPage()
    for attempt in range(2):
        html = fetch_flights_html(query, fetch_integration=fetcher)
        script = LexborHTMLParser(html).css_first(r"script.ds\:1")
        if script is None:
            raise ValueError("Google Flights 未返回航班数据，可能需要验证或页面结构已变化")
        try:
            payload = extract_payload(script.text())
            break
        except UpstreamUnavailable:
            if attempt:
                raise
            time.sleep(0.8)
    results, skipped = parse_payload(payload, args['fromAirport'], args['toAirport'], args['date'], args['maxStops'])
    results.sort(key=lambda r: (r['price'] is None, r['price'] or 0, r['departure']))
    return {"results": results[:args['limit']], "matchedCount": len(results),
            "skipped": skipped, "url": query.url()}


if __name__ == '__main__':
    try:
        value = search(json.load(sys.stdin))
        print(json.dumps({"ok": True, **value}, ensure_ascii=False))
    except Exception as error:
        # No upstream HTML, proxy credentials or traceback in user-visible errors.
        message = str(error) if isinstance(error, ValueError) else "机票查询失败，请检查 Google Flights 网络连接或稍后重试"
        print(json.dumps({"ok": False, "error": message}, ensure_ascii=False))
        sys.exit(1)
