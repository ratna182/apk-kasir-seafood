export const DEFAULT_BRANCH_NAME =
  process.env.NEXT_PUBLIC_BRANCH_NAME?.trim() || 'Seafood Vian Jaya 08 (Kranggan)'

export function formatBranchLine(branchName: string | null | undefined): string {
  return `Cabang : ${branchName?.trim() || DEFAULT_BRANCH_NAME}`
}
