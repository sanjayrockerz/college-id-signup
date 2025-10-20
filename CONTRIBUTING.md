# Contributing to Chat Backend

Thank you for considering contributing to this project! This document outlines guidelines for contributing.

## Project Scope and Boundaries

### 🎯 What This Project IS

This is a **chat transport and persistence backend** that provides:
- Real-time message delivery via Socket.IO
- Message persistence and retrieval
- Conversation/room management
- User presence tracking (online/offline/typing)
- Message history with pagination
- File attachment storage references

### 🚫 What This Project IS NOT

This project **does NOT and will NOT** implement:
- User authentication (JWT validation, login/logout, password handling)
- User authorization (access control, permissions, role checks)
- Session management
- User registration flows
- Email/phone verification
- OAuth integrations
- API key management

**Why?** This service is designed to be identity-agnostic and run behind an authenticated upstream gateway. See [docs/scope/no-auth-policy.md](docs/scope/no-auth-policy.md) for architectural rationale.

### ❌ Contributions We Will Reject

The following types of contributions will NOT be accepted:

- Authentication middleware or guards
- Login/register/logout endpoints
- Password hashing or credential storage
- JWT token generation or validation
- Authorization decorators or role checks
- "Add auth later" TODOs or placeholders
- Feature flags for "optional auth"

**Instead**: Direct contributors to implement authentication in an upstream service. This codebase maintains a permanent no-auth policy.

### ✅ Contributions We Welcome

We encourage contributions that:
- Improve message transport performance
- Enhance real-time delivery reliability
- Optimize database queries for message history
- Add message features (reactions, threading, formatting)
- Improve input validation and rate limiting
- Fix bugs in messaging logic
- Enhance monitoring and logging
- Improve documentation
- Add tests for chat functionality

---

## Getting Started

### Prerequisites

- Node.js 18+
- PostgreSQL 14+
- npm
- Git

### Setup

1. Fork and clone the repository:
```bash
git clone https://github.com/yourusername/chat-backend.git
cd chat-backend
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
```bash
cp .env.example .env
# Edit .env with your database credentials
```

4. Set up the database:
```bash
npx prisma migrate dev
npx prisma db seed  # Optional: seed with test data
```

5. Run the development server:
```bash
npm run start:dev
```

---

## Development Workflow

### Branch Naming

- `feature/` - New features
- `fix/` - Bug fixes
- `refactor/` - Code refactoring
- `docs/` - Documentation updates
- `test/` - Test additions or improvements

Examples:
- `feature/message-reactions`
- `fix/socket-disconnection-handling`
- `refactor/optimize-message-queries`

### Commit Messages

Follow conventional commits format:

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

Types:
- `feat`: New feature
- `fix`: Bug fix
- `refactor`: Code refactoring
- `docs`: Documentation
- `test`: Test updates
- `chore`: Build/tooling changes

Examples:
```
feat(chat): add message reactions support
fix(socket): handle reconnection edge cases
refactor(db): optimize conversation history queries
docs(api): update Socket.IO event documentation
```

---

## Code Standards

### TypeScript

- Use strict TypeScript types
- Avoid `any` type
- Export interfaces for public APIs
- Document complex types with JSDoc

```typescript
// Good
interface SendMessageDto {
  userId: string;
  conversationId: string;
  content: string;
  messageType: 'text' | 'image' | 'file';
}

// Bad
function sendMessage(data: any) { ... }
```

### Validation

- Use class-validator decorators for DTOs
- Validate all user inputs
- Return clear error messages

```typescript
import { IsString, IsNotEmpty, IsEnum } from 'class-validator';

export class SendMessageDto {
  @IsString()
  @IsNotEmpty()
  userId: string;

  @IsString()
  @IsNotEmpty()
  conversationId: string;

  @IsString()
  @IsNotEmpty()
  content: string;

  @IsEnum(['text', 'image', 'file'])
  messageType: string;
}
```

### Error Handling

- Use appropriate HTTP status codes
- Return consistent error format
- Log errors with context

```typescript
// Good
return res.status(400).json({
  success: false,
  error: 'Validation failed',
  message: 'conversationId is required'
});

// Bad
throw new Error('Missing field');
```

### Rate Limiting

- All new endpoints must have rate limiting
- Use appropriate tier based on endpoint purpose
- Document limits in API documentation

```typescript
import { apiLimiter, messagingLimiter } from './middleware/rate-limiter';

// Apply appropriate limiter
app.use('/api/chat/messages', messagingLimiter);
```

---

## Testing

### Running Tests

```bash
# Unit tests
npm run test

# E2E tests
npm run test:e2e

# Coverage
npm run test:cov
```

### Writing Tests

- Write tests for all new features
- Include happy path and error cases
- Test rate limiting behavior
- Mock external dependencies

```typescript
describe('ChatController', () => {
  it('should send a message successfully', async () => {
    const dto = {
      userId: 'user-1',
      conversationId: 'conv-1',
      content: 'Hello',
      messageType: 'text'
    };
    
    const result = await controller.sendMessage(dto);
    
    expect(result.success).toBe(true);
    expect(result.message.content).toBe('Hello');
  });

  it('should reject message without userId', async () => {
    const dto = {
      conversationId: 'conv-1',
      content: 'Hello'
    };
    
    await expect(controller.sendMessage(dto))
      .rejects
      .toThrow('userId is required');
  });
});
```

### Coverage Requirements

- Maintain minimum 50% branch coverage
- Maintain minimum 60% line coverage
- Ensure critical paths are tested

---

## Pull Request Process

1. **Create an issue first** (for non-trivial changes)
   - Describe the problem or feature
   - Discuss approach with maintainers

2. **Fork and create a branch**
   ```bash
   git checkout -b feature/your-feature-name
   ```

3. **Make your changes**
   - Follow code standards
   - Add tests
   - Update documentation

4. **Ensure all tests pass**
   ```bash
   npm run build
   npm run test
   npm run test:e2e
   ```

5. **Commit your changes**
   ```bash
   git add .
   git commit -m "feat(scope): description"
   ```

6. **Push to your fork**
   ```bash
   git push origin feature/your-feature-name
   ```

7. **Create a Pull Request**
   - Fill out the PR template
   - Link related issues
   - Describe changes and testing

### PR Checklist

- [ ] Code follows project style guidelines
- [ ] Tests added/updated and passing
- [ ] Documentation updated (if applicable)
- [ ] No authentication/authorization code added
- [ ] Rate limiting applied to new endpoints
- [ ] Input validation implemented for new DTOs
- [ ] Commit messages follow conventional commits
- [ ] Branch is up to date with main

---

## Documentation

### When to Update Docs

Update documentation when:
- Adding new API endpoints
- Changing Socket.IO events
- Modifying request/response formats
- Adding new features
- Changing configuration options

### Documentation Files

- `README.md` - Project overview and setup
- `API_DOCUMENTATION.md` - REST API reference
- `docs/scope/no-auth-policy.md` - Architecture and trust model
- `docs/scope/upstream-integration.md` - Integration guide for upstream services
- `src/**/README.md` - Module-specific documentation

---

## Code Review

### For Contributors

- Be responsive to feedback
- Ask questions if feedback is unclear
- Update your PR based on review comments
- Keep PRs focused and reasonably sized

### For Reviewers

- Enforce the no-auth policy strictly
- Check for proper input validation
- Verify rate limiting is applied
- Ensure tests are adequate
- Be constructive and respectful

---

## Security

### Reporting Security Issues

**DO NOT** open public issues for security vulnerabilities.

Email security concerns to: [security@example.com]

Include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

### Security Guidelines

- Never store passwords or credentials
- Validate and sanitize all user inputs
- Use parameterized queries (Prisma protects against SQL injection)
- Apply rate limiting to all public endpoints
- Log security-relevant events
- Keep dependencies updated

---

## Community

### Code of Conduct

- Be respectful and inclusive
- Welcome newcomers
- Focus on constructive feedback
- No harassment or discrimination
- Follow GitHub's Community Guidelines

### Getting Help

- Check existing issues and documentation
- Ask questions in GitHub Discussions
- Join our community chat (if available)
- Tag maintainers for urgent issues

---

## License

By contributing, you agree that your contributions will be licensed under the same license as the project (see LICENSE file).

---

## Questions?

- Review [docs/scope/no-auth-policy.md](docs/scope/no-auth-policy.md) for architecture
- Check [API_DOCUMENTATION.md](API_DOCUMENTATION.md) for API details
- Open a GitHub Discussion for questions
- Create an issue for bugs or feature requests

Thank you for contributing! 🎉
