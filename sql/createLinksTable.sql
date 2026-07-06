CREATE TABLE IF NOT EXISTS links
(
  id INTEGER PRIMARY KEY,
  outgoing_links_count INTEGER NOT NULL,
  incoming_links_count INTEGER NOT NULL,
  outgoing_links TEXT NOT NULL,
  incoming_links TEXT NOT NULL
);

-- Load the tab-separated links file (piped in by buildDatabase.sh) from stdin. `.mode csv` with a
-- tab `.separator` treats each line as one row split on tabs, matching the trimmed dump format.
.mode csv
.separator "\t"
.import /dev/stdin links

CREATE INDEX links_outgoing_links_count_index ON links(outgoing_links_count);
CREATE INDEX links_incoming_links_count_index ON links(incoming_links_count);
