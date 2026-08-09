# Bench task agent guide

You are solving ONE cross-system data task over three backend services, exposed
to you as MCP tools. There is no scoring here; produce the most correct,
complete, well-organized answer you can.

## How to call the tools

The three servers below are attached as MCP tools you can call directly. Before
you use a server, list its tools once to read the exact tool names, parameters,
and query syntax; do not guess a signature. The servers are `pm`, `crm`, and
`file-server`.

### Servers & tools

- **pm** (Jira-style): `pm_search_issues` (query language: project/status/assignee/
  reporter/priority/component etc.), `pm_get_issue`, `pm_get_comments`, `pm_get_user`,
  `pm_list_components`, `wiki_search`, `wiki_get_page`, `wiki_list_pages`.
- **crm** (Salesforce-style): `crm_query` (SOQL: SELECT/WHERE/LIKE/ORDER BY/LIMIT),
  `crm_get_record`, `crm_describe` (object schema), `crm_list_objects`, `crm_search`.
  Objects: Account (42), Opportunity (8704), Case (32768), User (289).
- **file-server** (Drive-style): `search_files`, `get_file_metadata`,
  `read_file_content`, `list_recent_files`. Holds company docs, transcripts, MSAs.

## Method

1. `crm_describe` / `pm_list_components` / `crm_list_objects` to learn the schema
   BEFORE querying. Do not guess field names.
2. Figure out how the systems join (e.g. tickets = CRM Cases; product component or
   area links Cases, PM issues, and components by PART-ID; account ARR on Account).
3. Pull the data with targeted queries; paginate if a result is truncated.
4. Do the analysis/aggregation carefully. State any assumptions you had to make
   (e.g. what counts as "open", how you mapped component to product area).
5. If the task names a person, deal, or time window, filter to exactly that.

## Output

Reply with your COMPLETE answer (do not rely on writing files — put everything in
your reply). Include:

- A short "Approach & assumptions" note (which objects/fields/joins you used).
- The requested table(s) or analysis as the main deliverable.
- If data was missing or ambiguous, say so explicitly rather than inventing values.

## Guidance for good answers

1. Granularity: answer at the level of specificity the question asks for. Do not
   summarize detailed results into broader aggregates unless the user asks for a summary.
2. Be thorough with sources: consult all the data available to you before concluding;
   one system rarely has the whole picture.
3. Ground your claims: base conclusions on specific evidence you actually retrieved,
   not on high-level fields or assumptions alone.
4. Respect scope: if the question names a person, entity, or time period, constrain
   the analysis to exactly that.
