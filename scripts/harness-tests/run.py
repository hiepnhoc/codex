#!/usr/bin/env python3
"""Run the hcodex harness tests.

  run.py                 every offline test (no network, no real provider)
  run.py --live          also the checks of the real ~/.hcodex (test_live.py)
  run.py -k RT           only tests whose id or name contains "RT" (repeatable)
  run.py --list          print every test case: id, area, what it asserts
  run.py --jobs 1        run the test files one after another (default: 4 at a time)

The binary under test: $HCODEX_BIN, else `hcodex` on PATH, else ~/.hcodex/bin/hcodex.
Exit code 0 when nothing failed; known gaps (expected failures) and skips do not fail the run.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import os
import re
import sys
import time
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

AREAS = {
    "ID": "identity and home",
    "RQ": "request sent to the provider",
    "TN": "turn, tools, sandbox, sessions",
    "RT": "provider errors and retries",
    "MD": "model catalog and overrides",
    "PV": "providers, profiles, credentials",
    "AG": "sub-agents",
    "AS": "app-server contract of the desktop app",
    "SC": "scripts and shipped files",
    "LV": "this machine's ~/.hcodex (live)",
}


def case_id(test) -> str:
    match = re.match(r"test_([A-Z]{2})(\d+)_", getattr(test, "_testMethodName", ""))
    return f"{match.group(1)}-{match.group(2)}" if match else "?"


def summary(test) -> str:
    doc = (getattr(test, "_testMethodDoc", None) or "").strip()
    return doc.splitlines()[0].strip() if doc else getattr(test, "_testMethodName", str(test))


def flatten(suite):
    for item in suite:
        if isinstance(item, unittest.TestSuite):
            yield from flatten(item)
        else:
            yield item


class Result(unittest.TestResult):
    """Collects one row per test case (sub-test failures count against their test)."""

    def __init__(self):
        super().__init__()
        self.rows: dict[str, dict] = {}
        self._started: dict[str, float] = {}

    def startTest(self, test):
        super().startTest(test)
        self._started[test.id()] = time.time()
        self.rows[test.id()] = {"test": test, "status": "ok", "detail": "", "seconds": 0.0}

    def stopTest(self, test):
        super().stopTest(test)
        self.rows[test.id()]["seconds"] = time.time() - self._started[test.id()]

    def _mark(self, test, status, detail=""):
        row = self.rows.setdefault(test.id(), {"test": test, "status": "ok", "detail": "", "seconds": 0.0})
        if row["status"] in ("ok", "skip") or status == "FAIL":
            row["status"] = status
        row["detail"] = (row["detail"] + "\n" + detail).strip()

    def addFailure(self, test, err):
        super().addFailure(test, err)
        self._mark(test, "FAIL", self._exc_info_to_string(err, test))

    def addError(self, test, err):
        super().addError(test, err)
        self._mark(test, "FAIL", self._exc_info_to_string(err, test))

    def addSubTest(self, test, subtest, err):
        super().addSubTest(test, subtest, err)
        if err is not None:
            self._mark(test, "FAIL", f"[{subtest._subDescription()}]\n" + self._exc_info_to_string(err, test))

    def addSkip(self, test, reason):
        super().addSkip(test, reason)
        self._mark(test, "skip", reason)

    def addExpectedFailure(self, test, err):
        super().addExpectedFailure(test, err)
        self._mark(test, "gap")

    def addUnexpectedSuccess(self, test):
        super().addUnexpectedSuccess(test)
        self._mark(test, "fixed", "this known gap now passes: remove @unittest.expectedFailure from the test")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("-k", action="append", default=[], metavar="TEXT", help="only tests whose id or name contains TEXT")
    parser.add_argument("--live", action="store_true", help="also check the real ~/.hcodex")
    parser.add_argument("--list", action="store_true", help="list the test cases and exit")
    parser.add_argument("--jobs", type=int, default=4, help="test files run at the same time")
    args = parser.parse_args()
    if args.live:
        os.environ["HCODEX_TEST_LIVE"] = "1"

    from harness_lib import BIN  # after HCODEX_TEST_LIVE is set, before test modules load

    modules = sorted(name[:-3] for name in os.listdir(HERE) if name.startswith("test_") and name.endswith(".py"))
    if not args.live and not args.list:
        modules = [m for m in modules if m != "test_live"]
    loader = unittest.TestLoader()
    suites = {}
    for module in modules:
        tests = [t for t in flatten(loader.loadTestsFromName(module))]
        if args.k:
            tests = [t for t in tests if any(k.lower() in f"{case_id(t)} {t._testMethodName}".lower() for k in args.k)]
        if tests:
            suites[module] = sorted(tests, key=lambda t: t._testMethodName)
    if loader.errors:
        print("\n".join(loader.errors))
        return 2

    if args.list:
        for module, tests in suites.items():
            prefix = case_id(tests[0]).split("-")[0]
            print(f"\n{prefix}  {AREAS.get(prefix, module)}  ({len(tests)})")
            for test in tests:
                print(f"  {case_id(test):6s} {summary(test)}")
        print(f"\n{sum(len(t) for t in suites.values())} test cases")
        return 0

    print(f"binary: {BIN}")
    started = time.time()

    def run(module):
        result = Result()
        unittest.TestSuite(suites[module]).run(result)
        return result

    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, args.jobs)) as pool:
        results = dict(zip(suites, pool.map(run, suites)))

    counts = {"ok": 0, "FAIL": 0, "gap": 0, "skip": 0, "fixed": 0}
    failures = []
    for module in suites:
        for row in sorted(results[module].rows.values(), key=lambda r: r["test"]._testMethodName):
            counts[row["status"]] += 1
            note = ""
            if row["status"] == "skip":
                note = f"  [{row['detail'].splitlines()[0][:90]}]"
            print(f"{row['status']:5s} {case_id(row['test']):6s} {summary(row['test'])[:110]}{note}  ({row['seconds']:.1f}s)")
            if row["status"] in ("FAIL", "fixed"):
                failures.append(row)

    for row in failures:
        print(f"\n----- {row['status']} {case_id(row['test'])} {row['test']._testMethodName}\n{summary(row['test'])}\n{row['detail']}")

    took = time.time() - started
    print(
        f"\nharness tests: {counts['ok']} passed, {counts['FAIL']} failed, {counts['gap']} known gaps, "
        f"{counts['skip']} skipped"
        + (f", {counts['fixed']} known gaps now passing" if counts["fixed"] else "")
        + f"  ({took:.0f}s)"
    )
    return 1 if counts["FAIL"] else 0


if __name__ == "__main__":
    sys.exit(main())
