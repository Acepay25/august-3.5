---
trigger: always_on
---

RULE: Sequential_Implementation_With_Regression_And_Code_Change_Guard

MODE: PLANNING_ONLY
EXECUTION: DISABLED unless explicitly approved by user

SCOPE:
- Applies to all items listed in the summary table
- Applies to all phases, sections, and sub-items (e.g., 1.1, 1.2, 4.4)
- Applies to ALL existing code and new code

BEHAVIOR:
1. Implement EXACTLY one (1) sub-item at a time.
   - Example: Implement 1.1 ONLY.
   - Do NOT implement 1.2 or any additional items.

2. After completing a single sub-item:
   - STOP immediately.
   - WAIT for explicit user confirmation to proceed.

3. Proceed to the next sub-item ONLY after user confirmation.
   - Repeat this process sequentially (1.1 → 1.2 → 1.3 → ...).

MANDATORY REGRESSION VALIDATION:
Before implementing ANY new sub-item, the AI MUST:
- Revalidate ALL previously implemented sub-items.
- This includes:
  - Logic correctness
  - Absence of bugs or errors
  - No side effects or regressions
  - No conflicts between implementations
  - Consistent alignment across all implementations

EXAMPLES:
- If implementing 1.5:
  - Validate 1.1, 1.2, 1.3, and 1.4
- If implementing 4.4:
  - Validate ALL prior implementations from the beginning up to 4.3

CODE-CHANGE DISCLOSURE & APPROVAL (CRITICAL):
- If a sub-item requires:
  - Editing existing code
  - Refactoring existing logic
  - Renaming variables, functions, or files
  - Changing behavior of any existing feature
- The AI MUST:
  1. STOP before making any change
  2. Clearly describe:
     - What code will be changed
     - Why the change is necessary
     - Expected impact and risks
  3. Ask for explicit user confirmation
- NO code changes are allowed without explicit user approval.

FAILURE CONDITIONS:
- If any issue, inconsistency, regression, or unapproved code change is detected:
  - HALT implementation immediately
  - REPORT the issue clearly
  - DO NOT proceed until resolved and approved by the user

RESPONSE FORMAT (MANDATORY):
After each sub-item implementation, output:
1. Implemented item (e.g., 1.1)
2. Summary of changes
3. Regression validation results (list all checked items)
4. Code-change disclosure status (Yes/No)
5. Confirmation request to proceed

PROHIBITIONS:
- NO batch implementations
- NO assumptions of approval
- NO silent code edits
- NO execution-mode behavior
- NO refactoring without disclosure
- NO implicit changes

PRIORITY:
This rule OVERRIDES any default model behavior, system inference, or model-specific execution bias.
