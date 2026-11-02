import re, json, sys
src = sys.argv[1]; out = sys.argv[2]
html = open(src, encoding='utf-8').read()
# find the DATA = {...} assignment inside <script>
m = re.search(r'(?:const|let|var)\s+DATA\s*=\s*', html)
if not m:
    print("DATA not found"); sys.exit(1)
start = m.end()
# brace matching
depth = 0; i = start; in_str = None; esc = False
while i < len(html):
    c = html[i]
    if in_str:
        if esc: esc = False
        elif c == '\\': esc = True
        elif c == in_str: in_str = None
    else:
        if c in '"\'': in_str = c
        elif c == '{': depth += 1
        elif c == '}':
            depth -= 1
            if depth == 0:
                i += 1; break
    i += 1
raw = html[start:i]
data = json.loads(raw)
json.dump(data, open(out, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
def walk(o, path='', depth=0, lines=None):
    if lines is None: lines = []
    if depth > 2: return lines
    if isinstance(o, dict):
        for k, v in o.items():
            desc = type(v).__name__
            if isinstance(v, (list, dict)): desc += f'[{len(v)}]'
            elif isinstance(v, str): desc += f'({len(v)}ch)'
            lines.append('  '*depth + f'{k}: {desc}')
            walk(v, path+'/'+k, depth+1, lines)
    elif isinstance(o, list) and o:
        lines.append('  '*depth + f'[0] of {len(o)}: ' + (', '.join(list(o[0].keys())[:12]) if isinstance(o[0], dict) else type(o[0]).__name__))
    return lines
print(f"DATA json chars: {len(raw)}")
print('\n'.join(walk(data)))
