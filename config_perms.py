import json
import subprocess
import sys

# Login and get token
result = subprocess.run(
    ['curl', '-s', '-X', 'POST', 'http://localhost:1337/admin/login',
     '-H', 'Content-Type: application/json',
     '-d', '{"email":"dev@trackify.local","password":"Admin1234"}'],
    capture_output=True, text=True
)
login_data = json.loads(result.stdout)
token = login_data['data']['token']

# Get roles
result = subprocess.run(
    ['curl', '-s', 'http://localhost:1337/admin/roles',
     '-H', f'Authorization: Bearer {token}'],
    capture_output=True, text=True
)
roles_data = json.loads(result.stdout)
print("=== ROLES ===")
for role in roles_data.get('data', []):
    print(f"  id={role['id']}, name={role['name']}, code={role.get('code')}")

# Get permissions and find our content-type permissions
result = subprocess.run(
    ['curl', '-s', 'http://localhost:1337/admin/permissions',
     '-H', f'Authorization: Bearer {token}'],
    capture_output=True, text=True
)
perms_data = json.loads(result.stdout)
print(f"\n=== PERMISSIONS (total: {len(perms_data.get('data', []))}) ===")
for perm in perms_data.get('data', []):
    action = perm.get('action', '')
    if 'api::' in action:
        print(f"  id={perm['id']}, action={action}")
