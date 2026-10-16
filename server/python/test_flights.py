import unittest
from flights import parse_payload, local_time, extract_payload, UpstreamUnavailable


def offer(price=1000):
    segment = [None] * 23
    for index, value in {3: 'SHA', 4: '上海虹桥', 5: '北京首都', 6: 'PEK', 8: [8], 10: [10, 30],
                         11: 150, 20: [2026, 10, 23], 21: [2026, 10, 23], 22: ['HU', '7602', None, '海航']}.items():
        segment[index] = value
    flight = ['HU', ['海航'], [segment], 'SHA', None, None, 'PEK', None, None, 150]
    return [flight, [[None, price]] if price is not None else [[None]]]


class ParseTest(unittest.TestCase):
    def test_callback_metadata_and_upstream_error_are_distinct(self):
        self.assertEqual(extract_payload("AF_initDataCallback({data:[1,2,3,4], sideChannel: {},extra:true});"), [1, 2, 3, 4])
        with self.assertRaises(UpstreamUnavailable):
            extract_payload("AF_initDataCallback({data:[13,null],errorHasStatus: true,});")

    def test_both_groups_missing_price_and_deduplication(self):
        second = offer(None)
        second[0][2][0][22][1] = '7604'
        results, skipped = parse_payload([None, None, [[offer()]], [[offer(), second]]], 'SHA', 'PEK', '2026-10-23', 0)
        self.assertEqual(len(results), 2)
        self.assertEqual(results[0]['price'], 1000)
        self.assertIsNone(results[1]['price'])
        self.assertEqual(results[0]['name'], 'HU7602')
        self.assertEqual(skipped, 0)

    def test_time_midnight_and_omitted_zero_minutes(self):
        self.assertEqual(local_time([2026, 10, 23], [8]), '2026-10-23T08:00')
        self.assertEqual(local_time([2026, 10, 23], [None, 31]), '2026-10-23T00:31')

    def test_malformed_and_wrong_dates_are_not_no_flights(self):
        with self.assertRaises(ValueError):
            parse_payload([None, None, [[offer()]], None], 'SHA', 'PEK', '2026-10-24', 0)
        with self.assertRaises(ValueError):
            parse_payload([None] * 4, 'SHA', 'PEK', '2026-10-23', 0)

    def test_valid_empty_results(self):
        self.assertEqual(parse_payload([None, None, [None], [[]]], 'SHA', 'PEK', '2026-10-23', 0), ([], 0))


if __name__ == '__main__':
    unittest.main()
