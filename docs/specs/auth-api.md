# Auth API

## Login
- POST /auth/login
- Body: { email, password }
- Returns: token + companies

## Me
- GET /auth/me
- Header: Authorization: Bearer <token>

## Logout
- POST /auth/logout
- Header: Authorization: Bearer <token>
