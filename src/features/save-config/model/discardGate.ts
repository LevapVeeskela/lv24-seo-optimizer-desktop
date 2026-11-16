/**
 * Gate for actions that replace the loaded draft (workspace switch, reload).
 * The page owns the dialog; this keeps the decision testable and makes the
 * "no dirty draft, no prompt" rule explicit.
 */
export async function confirmDiscardBeforeAction(
  dirty: boolean,
  confirm: () => Promise<boolean>,
): Promise<boolean> {
  return dirty ? confirm() : true;
}
