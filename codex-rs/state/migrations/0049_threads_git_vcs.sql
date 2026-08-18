-- Which version control system the git_* columns describe.
--
-- Nullable with no default on purpose: NULL means "written before Subversion
-- was supported", and every such row came from a git-only build, so readers
-- resolve NULL to git. That is a fact about the existing data, not a fallback,
-- which is what makes this column free to add with no backfill.
ALTER TABLE threads ADD COLUMN git_vcs TEXT;
