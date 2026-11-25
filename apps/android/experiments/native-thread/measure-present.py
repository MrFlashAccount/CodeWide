#!/usr/bin/env python3
"""Measure a real catalog press through the first presented frame with visible text."""
import argparse
import csv
import io
import json
import subprocess

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--processor', required=True)
parser.add_argument('--range', action='store_true', help='inspect an isolated block sample')
parser.add_argument('trace', nargs='+')
args = parser.parse_args()
marker = 'cw.lab.range.ink' if args.range else 'cw.bubble.ink'
query = f"""
WITH tap AS (
  SELECT min(ts) AS start, count(*) AS count FROM slice WHERE name = 'cw.catalog.down'
), frames AS (
  SELECT tap.start, ink.ts AS ink, app.present_type AS kind, display.ts + display.dur AS present
  FROM slice ink JOIN tap ON tap.count = 1 AND ink.ts >= tap.start
  LEFT JOIN slice frame ON frame.track_id = ink.track_id AND frame.name GLOB 'Choreographer#doFrame [0-9]*'
    AND frame.ts <= ink.ts AND ink.ts < frame.ts + frame.dur
  LEFT JOIN actual_frame_timeline_slice app ON app.surface_frame_token = cast(substr(frame.name, 23) AS integer)
    AND app.layer_name LIKE '%dev.codexremote.app.preview/dev.codewide.app.MainActivity#%'
  LEFT JOIN actual_frame_timeline_slice display ON display.display_frame_token = app.display_frame_token
    AND display.surface_frame_token IS NULL AND display.dur > 0
  WHERE ink.name = '{marker}'
)
SELECT start, ink, present, kind FROM frames ORDER BY ink
"""
for filename in args.trace:
    result = subprocess.run([args.processor, '-Q', query, filename], capture_output=True, text=True, check=True)
    row = next((r for r in csv.DictReader(io.StringIO(result.stdout)) if 'Dropped' not in r['kind']), None)
    if row and row['present'].isdigit():
        elapsed = round((int(row['present']) - int(row['start'])) / 1e6, 1)
    else:
        elapsed = None
    print(json.dumps({'trace': filename, 'presentMs': elapsed}))
