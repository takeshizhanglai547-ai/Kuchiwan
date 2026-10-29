> Earlier checkpoint before the confirmed tool/midboss extension. See `CAMP_MIDBOSS_BALANCE_20261029.md` and final verification evidence for the latest candidate.

# Local quality/shop candidate — 2026-10-29

Base: public `7520d7c5e947a38a5b5dc133d8f009a9badbd85f`. This candidate is not published.

Implemented: articulated sniper/Sky Armor and other expansion enemy models; layered Sengoku geometry; source-priced Cham equipment shop after clears; native character weapon effects and visible equipment; saved game-coin companion collection and a maximum of three shared companions. Existing movement, command, grab, co-op, soundtrack and boss-phase systems are retained.

Original 2D research found 127 weapons, including 105 character-specific weapons. The native eligibility, pricing and equipment functions are reused. Watch has cross-character eligibility. Shop ownership, wallet and companion data use a separate versioned save key; unrelated original save fields are preserved.

Companion tuning is provisional: 90 coins per draw, seven equal outcomes, duplicate refund 30 coins, three companions total for the human team. No money, paid currency or external service is involved. The UI states cost, probability and duplicate handling before drawing.

Kosodoro is design-only. Enemy rank/placement, stolen amounts/caps, defeat recovery, and persistence across retries/stage changes need clarification. The unanswered voice-transcription phrases have not been interpreted as Chinese art direction or a midboss rank. No Kosodoro production enemy or unconfirmed item category is included.

Evidence: CPU-rendered actual THREE geometry comparisons under `evidence/model-polish-20261028`, `evidence/polish-20261028`, and `evidence/equipment-visual-20261028`. These show geometry and pose changes, not WebGL or iPad acceptance. The grimoire comparison revealed robe occlusion; its added display mesh was corrected without moving the original wrist or weapon anchors.

Verification limits: synthetic DOM/protocol/state tests cannot establish trusted multitouch, GPU performance, actual browser installation/offline lifecycle, audio quality or gameplay balance. Previously denied browser/PowerShell operations were not retried or bypassed. No push, authentication or Library upload was performed.

Final result: all 48 game CPU/synthetic-DOM suites passed, including fault-injection suites. PWA cache 16, UI 10 and isolated build-variant 2 cases passed. Local PWA release `5b88a1a1`.
