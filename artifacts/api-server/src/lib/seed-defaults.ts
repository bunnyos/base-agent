// Starter actions are no longer seeded as a separate set. The native action
// pack (lib/native-actions.ts) is now the only seeded set, so a brand-new user
// starts with exactly the built-in native actions and nothing else.
//
// Kept as a stable no-op entry point so the OAuth callback call site does not
// need to change, and so re-introducing custom starter actions later is a small,
// localized edit.
export async function seedDefaultActionsIfEmpty(_userId: string): Promise<void> {
  return;
}
