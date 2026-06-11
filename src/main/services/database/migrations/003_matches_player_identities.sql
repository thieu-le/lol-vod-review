-- The local player's identity strings (riotId / riotIdGameName / summonerName)
-- as a JSON string array. Needed to attribute events like FirstBlood/Multikill
-- to *the player* rather than any of the 10 participants. NULL for matches
-- recorded before this migration until a backfill fills it in.
ALTER TABLE matches ADD COLUMN player_identities TEXT;
