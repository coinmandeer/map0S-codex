"""Prepare bounded per-country JSONL inputs from the pinned GISCO LAU download.
Usage: python3 scripts/prepare-lau-import.py DOWNLOAD.geojson OUTPUT_DIR
Only offline preparation; never ships the continental file to a browser.
"""
import hashlib, json, pathlib, re, sys
source, output = map(pathlib.Path, sys.argv[1:3])
if source.stat().st_size > 256 * 1024 * 1024:
    raise ValueError('LAU download exceeds 256 MiB budget')
output.mkdir(parents=True, exist_ok=True)
payload = json.loads(source.read_text())
if payload.get('type') != 'FeatureCollection' or not payload.get('features'):
    raise ValueError('Expected a nonempty FeatureCollection')
files, counts, identities = {}, {}, set()
try:
    for feature in payload['features']:
        props = feature.get('properties') or {}
        country = {'EL':'GR','UK':'GB'}.get(props.get('CNTR_CODE'), props.get('CNTR_CODE'))
        code = props.get('GISCO_ID')
        if not isinstance(country,str) or not re.fullmatch('[A-Z]{2}',country) or not code:
            raise ValueError('Missing identity or country')
        if code in identities: raise ValueError('Duplicate LAU identity: '+code)
        identities.add(code)
        if feature.get('geometry',{}).get('type') not in ('Polygon','MultiPolygon'):
            raise ValueError('Invalid geometry type')
        if country not in files: files[country] = (output / (country+'.jsonl')).open('w')
        files[country].write(json.dumps(feature,ensure_ascii=False,separators=(',',':'))+'\n')
        counts[country] = counts.get(country,0)+1
finally:
    for handle in files.values(): handle.close()
report={'source':'GISCO LAU 2024','generalization':'1:1,000,000',
 'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),
 'countries':{country:{'count':count,'sha256':hashlib.sha256((output/(country+'.jsonl')).read_bytes()).hexdigest()} for country,count in sorted(counts.items())}}
(output/'manifest.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({'countries':len(counts),'features':sum(counts.values()),'sourceSha256':report['sourceSha256']}))
