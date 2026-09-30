"""SDK-independent regression checks for the native evidence gate."""
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
import unittest

spec = spec_from_file_location("menu_bar_runner", Path(__file__).with_name("test-menu-bar.py"))
runner = module_from_spec(spec)
spec.loader.exec_module(runner)


def completed_report(enabled: bool) -> dict:
    return {"keyboardNavigationEnabled": enabled,
            "checks": {name: True for name in runner.REQUIRED_CHECKS}}


class NativeEvidenceTests(unittest.TestCase):
    def test_accepts_both_complete_navigation_modes(self):
        for enabled in [False, True]:
            runner.validate_report(completed_report(enabled), enabled)

    def test_rejects_an_empty_report(self):
        with self.assertRaises(ValueError):
            runner.validate_report({"keyboardNavigationEnabled": True, "checks": {}}, True)

    def test_rejects_a_missing_contract(self):
        report = completed_report(True)
        del report["checks"]["disclosureChangesHeight"]
        with self.assertRaises(ValueError):
            runner.validate_report(report, True)

    def test_rejects_each_failed_contract(self):
        for name in runner.REQUIRED_CHECKS:
            with self.subTest(contract=name):
                report = completed_report(True)
                report["checks"][name] = False
                with self.assertRaises(ValueError):
                    runner.validate_report(report, True)

    def test_does_not_treat_truthy_values_as_passed_assertions(self):
        for value in [1, "true", None]:
            report = completed_report(True)
            report["checks"]["applicationRunning"] = value
            with self.assertRaises(ValueError):
                runner.validate_report(report, True)

    def test_rejects_an_incorrect_navigation_mode(self):
        with self.assertRaises(ValueError):
            runner.validate_report(completed_report(False), True)

    def test_rejects_an_operation_failure_even_with_green_checks(self):
        report = completed_report(True)
        report["failure"] = "timedOut"
        with self.assertRaises(ValueError):
            runner.validate_report(report, True)

    def test_rejects_malformed_external_reports(self):
        for report in [None, [], True, {"keyboardNavigationEnabled": True, "checks": []}]:
            with self.assertRaises(ValueError):
                runner.validate_report(report, True)


if __name__ == "__main__":
    unittest.main()
