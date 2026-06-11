# SOAP プロンプト変更履歴

## v3（2026-06）

**ファイル**: `lib/soapPrompt.v3.ts`（`lib/soapPrompt.ts` から re-export）

- 発言主体タグ `[本人][家族][スタッフ]` 等を S に必須化
- O に薬剤名・用量・用法の完全記載を必須化（「降圧剤継続中」禁止）
- Ep/Cp/Op 判定フローチャートを明文化（介護スタッフへの依頼 = Cp）
- 本人指導不可時の理由を Op に明記
- アクション状況（実行済み/依頼/提案）の明示
- Few-shot 入力を拡充（処方・要介護度・既往等）
- 参照: `docs/soap_improvement_proposal.md` Phase 1 + Phase 2

## v2（2026-06）

- 1メモ=1プロブレム=1SOAP 原則
- S/O/A/P 厳密判定ロジック
- Ep/Cp/Op 箇条書き構造
- Few-shot 3例（簡易入力版）
- 参照: `docs/requirements-soap.md` セクション9-10

## v1（2026-06）

- 初版プロンプト定義
- SOAP 4セクション structured output
- Few-shot 3例（文章形式の期待出力）
- `SoapPromptConfig` セクション ON/OFF 構造
