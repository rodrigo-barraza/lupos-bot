import json

with open('clocks_data.json', 'r') as f:
    data = json.load(f)

with open('/home/rodrigo/development/sun/lupos/constants/ClockCrewConstants.js', 'r') as f:
    lines = f.readlines()

chunks = []
for k, v in data.items():
    if not v['joinDate']: continue
    
    for i, line in enumerate(lines):
        if 'username:' in line and k.lower() in line.lower():
            for j in range(i, i+15):
                if 'joinDate: ""' in lines[j]:
                    target = ''.join(lines[j-1:j+2])
                    replacement = target.replace('joinDate: ""', f'joinDate: "{v["joinDate"]}"')
                    chunks.append({
                        'AllowMultiple': False,
                        'TargetContent': target,
                        'ReplacementContent': replacement,
                        'StartLine': j,
                        'EndLine': j + 2
                    })
                    break
            break

with open('chunks.json', 'w') as f:
    json.dump(chunks, f, indent=2)
