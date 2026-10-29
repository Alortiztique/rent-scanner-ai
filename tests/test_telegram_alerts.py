"""Offline regression checks. No credentials, real subscriber data or network are used."""
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
import alert_model
import bot
import bot_listener as listener
import notifier

DEAL = {
    "cityId": "berlin", "cityName": "Berlin", "title": "Rental [with] *punctuation*",
    "sourceUrl": "https://example.com/listing/1", "dealScore": 96,
    "priceLocal": 900, "priceUsd": 1000, "currency": "EUR", "type": "entire_apartment",
    "noBrokerFee": True, "utilitiesIncluded": True,
    "audit": {"summary": "Check the termination clause before signing.", "modelUsed": "nvidia/example"},
}
USER = {
    "chatId": 17, "firstName": "Sample Renter", "active": True, "cityId": "berlin",
    "cityName": "Berlin", "housingType": "all", "minDealScore": 95, "maxBudget": 1000,
}


class TelegramAlertsTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.users = self.root / "users.json"
        self.batch = self.root / "batch.json"
        self.state = self.root / "alerts.db"
        self.addCleanup(patch.stopall)
        patch("urllib.request.urlopen", side_effect=AssertionError("Real network forbidden")).start()
        patch.object(listener, "USERS_DB_FILE", self.users).start()
        listener.USER_SESSIONS.clear()

    def prepare(self, deals=None, user=None):
        self.batch.write_text(json.dumps([DEAL] if deals is None else deals), encoding="utf-8")
        self.users.write_text(json.dumps({"17": USER if user is None else user}), encoding="utf-8")

    def dispatch(self, **options):
        return notifier.process_batch(self.batch, users_db_file=self.users, state_db=self.state, **options)

    def test_job_city_names_and_budget_do_not_use_missing_price_as_zero(self):
        for city, name in (("nyc", "New York City"), ("sf", "San Francisco")):
            job = {"city": name, "url": DEAL["sourceUrl"], "raw_title": "Sublet",
                   "audit": {"fairRentScore": 96, "estimatedPriceUsd": 1500, "summary": "Inspect the lease."}}
            user = {**USER, "cityId": city, "maxBudget": None}
            self.assertTrue(notifier.deal_matches_user(job, user))
            self.assertFalse(notifier.deal_matches_user(job, {**user, "maxBudget": 100}))
            message = bot.format_deal_alert(job)
            self.assertIn("Asking rent: unavailable", message)
            self.assertIn("Model estimate: 1,500.00 USD", message)
            self.assertIn("Inspect the lease.", message)

    def test_local_and_global_budgets_compare_the_right_currency(self):
        self.assertTrue(notifier.deal_matches_user(DEAL, USER))
        self.assertFalse(notifier.deal_matches_user({**DEAL, "currency": "COP"}, USER))
        global_user = {**USER, "cityId": "all", "maxBudget": 950}
        self.assertFalse(notifier.deal_matches_user(DEAL, global_user))
        self.assertTrue(notifier.deal_matches_user({**DEAL, "priceUsd": 950}, global_user))
        self.assertFalse(notifier.deal_matches_user({**DEAL, "priceUsd": None}, global_user))
        self.assertFalse(notifier.deal_matches_user(DEAL, {**USER, "maxBudget": 0}))

    def test_threshold_is_at_least_95_and_stricter_batch_floor_applies_to_dms(self):
        self.assertFalse(notifier.deal_matches_user({**DEAL, "dealScore": 94}, {**USER, "minDealScore": 90}))
        self.assertTrue(notifier.deal_matches_user({**DEAL, "dealScore": 95}, USER))
        self.prepare()
        self.assertEqual(self.dispatch(min_score=97)["previews"], [])
        self.assertFalse(self.dispatch(min_score=90)["ok"])

    def test_explicit_type_and_boolean_facts_own_restrictive_matching(self):
        user = {**USER, "housingType": "entire_apartment", "utilitiesIncludedOnly": True, "noBrokerFeeOnly": True}
        self.assertTrue(notifier.deal_matches_user(DEAL, user))
        for change in ({"type": "studio"}, {"utilitiesIncluded": False}, {"noBrokerFee": False}):
            deal = {**DEAL, **change, "audit": {"verifiedPerks": ["Gas not included", "No broker fee"]}}
            self.assertFalse(notifier.deal_matches_user(deal, user))
        self.assertFalse(notifier.deal_matches_user(DEAL, {**USER, "active": False}))
        self.assertFalse(notifier.deal_matches_user(DEAL, {**USER, "cityId": "unknown"}))

    def test_malformed_scores_urls_and_city_identity_fail_closed(self):
        for change in ({"dealScore": True}, {"dealScore": float("nan")}, {"dealScore": float("inf")},
                       {"dealScore": 10 ** 1000}, {"dealScore": 101}, {"audit": None},
                       {"sourceUrl": "javascript:alert(1)"}, {"cityName": "New York City"}, {"kind": "scout"}):
            self.assertIsNone(alert_model.normalize_deal({**DEAL, **change}))

    def test_formatter_uses_provided_summary_and_never_invents_verification_or_perks(self):
        message = bot.format_deal_alert(DEAL)
        self.assertIn(DEAL["audit"]["summary"], message)
        self.assertIn(DEAL["sourceUrl"], message)
        self.assertNotIn("Verified Lease", message)
        self.assertNotIn("Zero broker", message)
        self.assertNotIn("Scam Risk: 0", message)
        self.assertIn("Sample data.", bot.format_deal_alert(bot.SAMPLE_BOGOTA_DEAL))
        fallback = {**DEAL, "audit": {"modelUsed": "simulated/nemotron-fallback"}}
        self.assertIn("DEMO ALERT", bot.format_deal_alert(fallback))

    def test_transport_is_shared_plain_text_and_does_not_echo_secret_urls(self):
        with patch.object(bot, "send_api_request", return_value={"ok": True}) as api:
            bot.send_telegram_alert(DEAL, "@sample")
            bot.send_personal_alert(DEAL, USER)
            for call in api.call_args_list:
                self.assertEqual(call.args[0], "sendMessage")
                self.assertNotIn("parse_mode", call.args[1])
        with patch.object(bot, "_bot_token", return_value="123:offline-secret"), patch("urllib.request.urlopen", side_effect=OSError("https://api.telegram.org/bot123:offline-secret/sendMessage")):
            result = bot.send_api_request("sendMessage", {"chat_id": 17, "text": "Sample"})
            self.assertFalse(result["ok"])
            self.assertNotIn("offline-secret", json.dumps(result))

    def test_corrupt_or_invalid_subscriber_files_are_not_overwritten(self):
        for contents in ("{broken", "[]", '{"17": false}'):
            self.users.write_text(contents, encoding="utf-8")
            with self.assertRaises(ValueError):
                listener.save_user_profile(18, USER)
            self.assertEqual(self.users.read_text(encoding="utf-8"), contents)

    def test_atomic_save_preserves_existing_data_on_replace_failure(self):
        self.prepare()
        before = self.users.read_bytes()
        with patch.object(Path, "replace", side_effect=OSError("Disk unavailable")):
            with self.assertRaises(OSError):
                listener.save_user_profile(18, USER)
        self.assertEqual(self.users.read_bytes(), before)
        self.assertEqual(list(self.root.glob("users_db.*.tmp")), [])
        with ThreadPoolExecutor(max_workers=2) as executor:
            list(executor.map(lambda chat: listener.save_user_profile(chat, {**USER, "chatId": chat}), [18, 19]))
        self.assertEqual(set(listener.load_users_db()), {"17", "18", "19"})

    def fake_api(self, endpoint, payload, **kwargs):
        self.messages.append((endpoint, payload))
        return {"ok": True, "result": {"message_id": len(self.messages)}}

    def text(self, text, private=True):
        listener.handle_text_message({"chat": {"id": 17, "type": "private" if private else "group"}, "from": {"id": 17}, "text": text})

    def callback(self, data, message_id=None):
        listener.handle_callback_query({"id": "sample", "from": {"id": 17, "first_name": "Alex_*"},
            "message": {"chat": {"id": 17, "type": "private"}, "message_id": message_id if message_id is not None else listener.USER_SESSIONS[17]["messageId"]}, "data": data})

    def start_wizard(self):
        self.messages = []
        patch.object(listener, "send_api_request", side_effect=self.fake_api).start()
        self.text("/start web")

    def test_complete_wizard_saves_95_floor_and_old_buttons_cannot_reset_it(self):
        self.start_wizard()
        for value in ("city:nyc", "type:entire_apartment", "budget:1400", "broker:any", "bills:any"):
            self.callback(value)
        profile = listener.load_users_db()["17"]
        self.assertEqual(profile["cityId"], "nyc")
        self.assertEqual(profile["minDealScore"], 95)
        self.assertEqual(profile["maxBudget"], 1400)
        before = self.users.read_bytes()
        self.callback("bills:yes", message_id=1)
        self.assertEqual(self.users.read_bytes(), before)
        self.assertNotIn(17, listener.USER_SESSIONS)
        self.text("/stop")
        self.assertFalse(listener.load_users_db()["17"]["active"])

    def test_budgets_preserve_decimals_and_invalid_input_does_not_advance(self):
        self.start_wizard()
        self.callback("city:london")
        self.callback("type:all")
        self.text("-500")
        self.assertEqual(listener.USER_SESSIONS[17]["step"], "BUDGET")
        self.text("1000.50")
        self.assertEqual(listener.USER_SESSIONS[17]["maxBudget"], 1000.5)
        self.assertEqual(listener.USER_SESSIONS[17]["step"], "BROKER")
        for text in ("-500", "1,000", "1e3", "NaN", "1.234", "9" * 1000):
            self.assertIsNone(listener.parse_budget(text))

    def test_wrong_steps_payloads_or_group_messages_cannot_create_subscriptions(self):
        self.start_wizard()
        original = deepcopy(listener.USER_SESSIONS[17])
        self.callback("bills:yes")
        self.callback("city:unknown")
        self.assertEqual(listener.USER_SESSIONS[17], original)
        self.assertFalse(self.users.exists())
        listener.USER_SESSIONS.clear()
        self.text("/start", private=False)
        self.assertFalse(listener.USER_SESSIONS)

    def test_dry_run_has_no_delivery_or_ledger_and_live_mode_skips_demo(self):
        self.prepare()
        with patch.object(notifier, "send_telegram_alert") as send, patch.object(notifier, "send_personal_alert") as personal:
            result = self.dispatch()
            self.assertEqual(len(result["previews"]), 2)
            self.assertIn(DEAL["audit"]["summary"], result["previews"][0]["message"])
            self.assertFalse(self.state.exists())
            send.assert_not_called()
            personal.assert_not_called()
            self.prepare([{**DEAL, "demo": True}])
            result = self.dispatch(dry_run=False)
            self.assertEqual(result["skipped_demo"], 1)
            send.assert_not_called()
            personal.assert_not_called()

    def test_successful_deliveries_persist_and_failed_deliveries_retry(self):
        self.prepare()
        with patch.object(notifier, "send_telegram_alert", return_value={"ok": True}) as send, patch.object(notifier, "send_personal_alert", return_value={"ok": False}) as personal:
            result = self.dispatch(dry_run=False)
            self.assertEqual((result["sent"], result["failed"]), (1, 1))
            self.assertFalse(result["ok"])
            personal.return_value = {"ok": True}
            result = self.dispatch(dry_run=False)
            self.assertEqual((result["sent"], result["duplicate"]), (1, 1))
            result = self.dispatch(dry_run=False)
            self.assertEqual((result["sent"], result["duplicate"]), (0, 2))
            self.assertEqual(send.call_count, 1)
            self.assertEqual(personal.call_count, 2)

    def test_parallel_dispatchers_do_not_send_the_same_destination_twice(self):
        self.prepare()
        with patch.object(notifier, "send_telegram_alert", return_value={"ok": True}) as send:
            with ThreadPoolExecutor(max_workers=2) as executor:
                results = list(executor.map(lambda _: self.dispatch(dry_run=False, notify_users=False), range(2)))
            self.assertEqual(sum(result["sent"] for result in results), 1)
            self.assertEqual(send.call_count, 1)

    def test_unreadable_input_or_ledger_prevents_delivery(self):
        self.prepare()
        with patch.object(notifier, "send_telegram_alert") as send:
            self.users.write_text("{broken", encoding="utf-8")
            self.assertFalse(self.dispatch(dry_run=False)["ok"])
            self.prepare()
            self.state.write_text("not sqlite", encoding="utf-8")
            self.assertFalse(self.dispatch(dry_run=False)["ok"])
            send.assert_not_called()


if __name__ == "__main__":
    unittest.main()
