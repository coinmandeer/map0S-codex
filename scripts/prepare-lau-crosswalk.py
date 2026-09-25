"""Extract the official LAU 2024 / NUTS 2024 workbook, preserving EU codes.
python3 scripts/prepare-lau-crosswalk.py source.xlsx output.json [CZ ES ...]
Reads ZIP/XML with the standard library; never guesses codes from place names.
"""
import hashlib, json, pathlib, posixpath, re, sys, zipfile
import xml.etree.ElementTree as E
SOURCE_URL = 'https://ec.europa.eu/eurostat/documents/345175/501971/EU-27-LAU-2024-NUTS-2024.xlsx/12971f56-c035-dbab-4d9f-ff1dcc617bb3'
source, output = map(pathlib.Path, sys.argv[1:3])
requested = set(sys.argv[3:])
if source.stat().st_size > 32*1024*1024: raise ValueError('Workbook exceeds input limit')
ns = {'m':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
with zipfile.ZipFile(source) as z:
    if sum(f.file_size for f in z.infolist()) > 256*1024*1024: raise ValueError('Expanded workbook exceeds limit')
    strings = [''.join(t.text or '' for t in s.iter() if t.tag.endswith('}t')) for s in E.fromstring(z.read('xl/sharedStrings.xml'))]
    rels = {r.get('Id'):posixpath.normpath('xl/'+r.get('Target')) for r in E.fromstring(z.read('xl/_rels/workbook.xml.rels'))}
    result, seen, coverage = [], set(), {}
    for sheet in E.fromstring(z.read('xl/workbook.xml')).find('m:sheets',ns):
        country = sheet.get('name')
        if not re.fullmatch('[A-Z]{2}',country) or (requested and country not in requested): continue
        path = rels[sheet.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id')]
        headers = None
        for _, row in E.iterparse(z.open(path),events=['end']):
            if not row.tag.endswith('}row'): continue
            cells = {}
            for c in row:
                v=c.find('m:v',ns)
                cells[re.sub(r'\d','',c.get('r'))] = strings[int(v.text)] if v is not None and c.get('t')=='s' else (v.text if v is not None else '')
            if headers is None:
                if cells.get('A')!='NUTS3' or cells.get('C')!='EU LAU CODE': raise ValueError('Unexpected country schema: '+country)
                headers=cells; continue
            nuts,lau = cells.get('A',''),cells.get('C','')
            if not nuts and not lau: continue
            if not re.fullmatch(country+r'[A-Z0-9]{3}',nuts) or not lau.startswith(country+'_') or not re.fullmatch(r'[A-Z]{2}_[A-Za-z0-9_.-]+',lau): raise ValueError('Invalid official codes: '+repr(cells))
            if lau in seen: raise ValueError('Duplicate official LAU: '+lau)
            seen.add(lau); result.append({'country':{'EL':'GR','UK':'GB'}.get(country,country),'lau':lau,'nuts3':nuts})
            coverage[country]=coverage.get(country,0)+1
            row.clear()
if requested-set(coverage): raise ValueError('Requested country is absent')
output.write_text(json.dumps({'schema':1,'lauYear':'2024','nutsEdition':'2024','sourceUrl':SOURCE_URL,'sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'coverage':coverage,'rows':result},ensure_ascii=False,separators=(',',':'))+'\n')
print(json.dumps({'rows':len(result),'coverage':coverage}))
