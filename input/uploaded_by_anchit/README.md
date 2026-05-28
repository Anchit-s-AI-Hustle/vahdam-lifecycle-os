# Uploaded by Anchit — raw source exports

Drop CSVs here. The dashboard's "Link Database" → "Import uploads" flow
reads from this folder and writes into whichever Supabase schema you've
linked the app to.

## Files currently here

| File | Source | Rows | Maps to table |
|---|---|---|---|
| `shopify_customers.csv` | Shopify customer export | ~26.7K | `<schema>.shopify_customers` |
| `shopify_orders.csv` | Shopify order export (line-item per row) | ~110 | `<schema>.shopify_orders_lines` |
| `shopify_products.csv` | Shopify product/variant export | ~3.3K | `<schema>.shopify_products` |
| `klaviyo_campaigns.csv` | Klaviyo campaigns May 2023 → May 2026 | 321 | `<schema>.klaviyo_campaigns` |
| `klaviyo_flows__sample_5k.csv` | First 5K rows of the 124MB Klaviyo Flows export | 5K (of 720K) | `<schema>.klaviyo_flow_events` |
| `webengage_users__sample_5k.csv` | First 5K rows of the WebEngage user export (30MB / 129K total) | 5K (of 129K) | `<schema>.webengage_users` |

> The two giant files (`Klaviyo Flows … 124MB` and `WebEngage user report … 30MB ×2`)
> stay on your Desktop — only a 5K-row sample is committed to git. The full files
> get streamed in via `scripts/ingest-uploads.js` when you point it at the
> linked DB; samples here are for schema verification + local UI testing.

## What "uploaded_by_anchit" means

This folder is the **input** spool. Anything dropped here is treated as data
you uploaded yourself and gets ingested verbatim. Renaming a file to one of
the canonical names above lets the ingest script auto-detect its schema —
otherwise, add a `--map filename=table_name` flag.

## Where the data goes

When you click **Link Database** in the dashboard and pick a Supabase project
+ schema name (default: `uploaded_by_anchit`), the ingest script runs the DDL
in `data/schemas/uploaded_data.sql` against that schema, then uses Postgres
`COPY` to stream each CSV in. The app dashboard then queries from there
instead of the synthetic seed.

One DB linked at a time. Re-link any time from the same modal — the previous
link is stored in localStorage as `lifecycle-linked-db` and overwritten on
re-link.
