import { redirect } from 'next/navigation'

// The automation rules became a module tab (the menu follows Finmap): /<org>/rules. Old links and bookmarks land here.
export default async function SettingsRulesRedirect({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params
  redirect(`/${encodeURIComponent(orgSlug)}/rules`)
}
