/* BattyRaid · connection settings.
 *
 * Split out of raid.js so that pointing the page at the Supabase project is a
 * two-line edit rather than a diff against application code.
 *
 * Both values below are public by design and safe to commit: the URL is an
 * endpoint and the publishable key only ever grants what RLS allows, which for
 * a signed-out visitor is the raid_heatmap() and raid_stats() functions and
 * nothing else. See raid/sql/001_schema.sql. Do NOT put a service
 * role key or the database password here -- those bypass RLS entirely.
 *
 * If these are ever blanked out the page runs read-only and shows a setup
 * notice instead of silently failing.
 */
window.RAID_CONFIG = {
  url: 'https://bbqauqqymjxqcyurxmna.supabase.co',
  key: 'sb_publishable_0wB8tbr7yclMFE3uXqJblg_-etHxkiL',
};
