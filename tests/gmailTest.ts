// gmailAgent.test.ts

import {
    SendEmailTool,
    ReadEmailsTool,
    SearchEmailsTool,
    ManageEmailTool,
    DraftEmailTool,
    MonitorRepliesTool,
    ManageLabelsTool,
    GetContactsTool,
    GmailService,
    GmailConfig,
  } from '../tools/gmailTools';// Assuming your file is named gmailAgent.ts
  import { RunnableConfig } from '@langchain/core/runnables';
  
  // Mock the entire 'googleapis' library
  jest.mock('googleapis', () => {
    // Create a deep mock of the gmail_v1.Gmail object
    const mockGmail = {
      users: {
        messages: {
          get: jest.fn(),
          list: jest.fn(),
          send: jest.fn(),
          modify: jest.fn(),
          trash: jest.fn(),
          untrash: jest.fn(),
        },
        drafts: {
          create: jest.fn(),
          list: jest.fn(),
          get: jest.fn(),
          send: jest.fn(),
          delete: jest.fn(),
        },
        threads: {
          get: jest.fn(),
        },
        labels: {
          create: jest.fn(),
          list: jest.fn(),
        },
      },
    };
    return {
      google: {
        gmail: jest.fn(() => mockGmail),
      },
    };
  });
  
  // Helper to get the mocked gmail object for assertions
  const { google } = require('googleapis');
  const mockGmailClient = google.gmail();
  
  // Define a mock Gmail configuration for tests
  const mockGmailConfig: GmailConfig = {
    credentials: {
      client_id: 'test-client-id',
      client_secret: 'test-client-secret',
      refresh_token: 'test-refresh-token',
    },
    scopes: ['https://www.googleapis.com/auth/gmail.modify'],
  };
  
  const runnableConfig: RunnableConfig = {
    configurable: {
      gmailConfig: mockGmailConfig,
    },
  };
  
  // Helper to get the config in the same way the tools do
  function getRunnableConfig(config: GmailConfig): RunnableConfig {
      return { configurable: { gmailConfig: config } };
  }
  
  
  describe('Gmail Agent Tools', () => {
    // Reset mocks before each test to ensure isolation
    beforeEach(() => {
      jest.clearAllMocks();
    });
  
    // --- Tests for GmailService ---
    describe('GmailService', () => {
      it('should correctly build a query string from a filter object', () => {
        const service = new GmailService(mockGmailConfig);
        const filter = {
          unreadOnly: true,
          sender: 'dwivediavichal656@gmail.com',
          hasAttachment: true,
          label: 'Work',
          folder: 'Sent',
          dateRange: {
            from: new Date('2023-01-01T00:00:00.000Z'),
            to: new Date('2023-01-31T23:59:59.999Z'),
          },
        };
        const expectedQuery = 'is:unread from:dwivediavichal656@gmail.com has:attachment label:Work in:sent after:2023-01-01 before:2023-01-31';
        expect(service.buildQuery(filter)).toBe(expectedQuery);
      });
    });
  
    // --- Tests for SendEmailTool ---
    describe('SendEmailTool', () => {
      it('should successfully send a simple email', async () => {
        mockGmailClient.users.messages.send.mockResolvedValue({
          data: { id: 'msg-123', threadId: 'thread-456' },
        });
  
        const input = {
          recipients: ['dwivediavichal5@gmail.com'],
          subject: 'Test Subject',
          body: 'Hello World',
        };
  
        const result = await SendEmailTool.invoke(input, getRunnableConfig(mockGmailConfig));
  
        expect(result.success).toBe(true);
        expect(result.messageId).toBe('msg-123');
        expect(mockGmailClient.users.messages.send).toHaveBeenCalledTimes(1);
      });
  
      it('should handle scheduled emails without sending', async () => {
        const input = {
          recipients: ['dwivediavichal5@gmail.com'],
          subject: 'Scheduled Email',
          body: 'This is a test.',
          scheduleTime: '2025-12-25T10:00:00Z',
        };
  
        const result = await SendEmailTool.invoke(input, getRunnableConfig(mockGmailConfig));
  
        expect(result.success).toBe(true);
        expect(result.scheduled).toBe(true);
        expect(result.message).toContain('Email scheduled for');
        expect(mockGmailClient.users.messages.send).not.toHaveBeenCalled();
      });
  
      it('should fail if Gmail configuration is not provided', async () => {
          const input = { recipients: ['dwivediavichal5@gmail.com'], subject: 'Test', body: 'Body' };
          // Pass an empty config
          const result = await SendEmailTool.invoke(input, { configurable: {} });
  
          expect(result.success).toBe(false);
          expect(result.error).toBe('Gmail configuration is required');
      });
    });
  
    // --- Tests for ReadEmailsTool ---
    describe('ReadEmailsTool', () => {
      it('should fetch and parse emails successfully', async () => {
        mockGmailClient.users.messages.list.mockResolvedValue({
          data: {
            messages: [{ id: 'msg-1' }, { id: 'msg-2' }],
            resultSizeEstimate: 2,
          },
        });
        mockGmailClient.users.messages.get
          .mockResolvedValueOnce({
            data: {
              id: 'msg-1',
              threadId: 'thread-1',
              internalDate: '1672531200000', // Jan 1, 2023
              labelIds: ['INBOX', 'UNREAD'],
              payload: {
                headers: [
                  { name: 'Subject', value: 'Email 1' },
                  { name: 'From', value: 'dwivediavichal656@gmail.com' },
                  { name: 'To', value: 'dwivediavichal5@gmail.com' },
                ],
                parts: [{ mimeType: 'text/plain', body: { data: Buffer.from('Body 1').toString('base64') } }],
              },
            },
          })
          .mockResolvedValueOnce({
              data: {
                id: 'msg-2',
                threadId: 'thread-2',
                internalDate: '1672617600000', // Jan 2, 2023
                labelIds: ['INBOX'],
                payload: {
                  headers: [
                    { name: 'Subject', value: 'Email 2' },
                    { name: 'From', value: 'dwivediavichal656@gmail.com' },
                    { name: 'To', value: 'dwivediavichal5@gmail.com' },
                  ],
                  parts: [{ mimeType: 'text/plain', body: { data: Buffer.from('Body 2').toString('base64') } }],
                },
              },
          });
  
        const result = await ReadEmailsTool.invoke({ limit: 2 }, getRunnableConfig(mockGmailConfig));
  
        expect(result.success).toBe(true);
        expect(result.count).toBe(2);
        expect(result.emails.length).toBe(2);
        expect(result.emails[0].subject).toBe('Email 1');
        expect(result.emails[0].isRead).toBe(false);
        expect(result.emails[1].body).toBe('Body 2');
        expect(result.emails[1].isRead).toBe(true);
        expect(mockGmailClient.users.messages.list).toHaveBeenCalledWith(expect.objectContaining({ maxResults: 2 }));
      });
    });
  
    // --- Tests for SearchEmailsTool ---
    describe('SearchEmailsTool', () => {
      it('should construct a complex query and return results', async () => {
          mockGmailClient.users.messages.list.mockResolvedValue({
              data: { messages: [{ id: 'search-res-1' }], resultSizeEstimate: 1 },
          });
          mockGmailClient.users.messages.get.mockResolvedValue({
              data: { id: 'search-res-1', payload: { headers: [{ name: 'Subject', value: 'Project Update' }] } },
          });
  
          const input = {
              query: 'Project Update',
              searchIn: ['subject'] as ('subject' | 'body' | 'from' | 'to' | 'all')[],
              dateRange: { from: '2023-01-01' },
              hasAttachment: true,
              isImportant: true,
              labels: ['work'],
              excludeLabels: ['personal'],
          };
  
          const result = await SearchEmailsTool.invoke(input, getRunnableConfig(mockGmailConfig));
  
          expect(result.success).toBe(true);
          expect(result.count).toBe(1);
          expect(mockGmailClient.users.messages.list).toHaveBeenCalledTimes(1);
          const actualQuery = mockGmailClient.users.messages.list.mock.calls[0][0].q;
          expect(actualQuery).toContain('subject:(Project Update)');
          expect(actualQuery).toContain('after:2023-01-01');
          expect(actualQuery).toContain('has:attachment');
          expect(actualQuery).toContain('is:important');
          expect(actualQuery).toContain('label:work');
          expect(actualQuery).toContain('-label:personal');
      });
    });
  
    // --- Tests for ManageEmailTool ---
    describe('ManageEmailTool', () => {
      it('should archive an email by removing INBOX label', async () => {
        const input = { emailIds: ['msg-1'], action: 'archive' as const };
        await ManageEmailTool.invoke(input, getRunnableConfig(mockGmailConfig));
  
        expect(mockGmailClient.users.messages.modify).toHaveBeenCalledWith({
          userId: 'me',
          id: 'msg-1',
          requestBody: { removeLabelIds: ['INBOX'] },
        });
      });
  
      it('should mark an email as unread by adding UNREAD label', async () => {
          const input = { emailIds: ['msg-1'], action: 'mark_unread' as const };
          await ManageEmailTool.invoke(input, getRunnableConfig(mockGmailConfig));
  
          expect(mockGmailClient.users.messages.modify).toHaveBeenCalledWith({
              userId: 'me',
              id: 'msg-1',
              requestBody: { addLabelIds: ['UNREAD'] },
          });
      });
  
      it('should move an email to trash', async () => {
          const input = { emailIds: ['msg-1'], action: 'move_to_trash' as const };
          await ManageEmailTool.invoke(input, getRunnableConfig(mockGmailConfig));
          expect(mockGmailClient.users.messages.trash).toHaveBeenCalledWith({ userId: 'me', id: 'msg-1' });
      });
  
      it('should add new labels to an email', async () => {
          const input = { emailIds: ['msg-1'], action: 'mark_read' as const, addLabels: ['processed'] };
          await ManageEmailTool.invoke(input, getRunnableConfig(mockGmailConfig));
          // It's called twice, once for the action, once for the label modification
          expect(mockGmailClient.users.messages.modify).toHaveBeenCalledTimes(2);
          expect(mockGmailClient.users.messages.modify).toHaveBeenCalledWith(expect.objectContaining({
              requestBody: { addLabelIds: ['processed'], removeLabelIds: undefined },
          }));
      });
    });
  
    // --- Tests for DraftEmailTool ---
    describe('DraftEmailTool', () => {
      it('should create a new draft', async () => {
          mockGmailClient.users.drafts.create.mockResolvedValue({
              data: { id: 'draft-123' },
          });
          const input = {
              action: 'create' as const,
              recipients: ['dwivediavichal5@gmail.com'],
              subject: 'Draft Subject',
              body: 'Work in progress',
          };
          const result = await DraftEmailTool.invoke(input, getRunnableConfig(mockGmailConfig));
          expect(result.success).toBe(true);
          expect(result.draftId).toBe('draft-123');
          expect(mockGmailClient.users.drafts.create).toHaveBeenCalledTimes(1);
      });
  
      it('should send an existing draft', async () => {
          mockGmailClient.users.drafts.send.mockResolvedValue({
              data: { id: 'sent-msg-1', threadId: 'thread-1' },
          });
          const input = { action: 'send' as const, draftId: 'draft-to-send' };
          const result = await DraftEmailTool.invoke(input, getRunnableConfig(mockGmailConfig));
          expect(result.success).toBe(true);
          expect(result.messageId).toBe('sent-msg-1');
          expect(mockGmailClient.users.drafts.send).toHaveBeenCalledWith({
              userId: 'me',
              requestBody: { id: 'draft-to-send' },
          });
      });
    });
  
    // --- Tests for MonitorRepliesTool ---
    describe('MonitorRepliesTool', () => {
      it('should setup monitoring for a threadId', async () => {
          mockGmailClient.users.threads.get.mockResolvedValue({
              data: { messages: [{ id: 'msg-1', internalDate: '1672531200000' }], id: 'thread-1' },
          });
          const input = { threadId: 'thread-1' };
          const result = await MonitorRepliesTool.invoke(input, getRunnableConfig(mockGmailConfig));
          expect(result.success).toBe(true);
          expect(result.monitoringId).toBeDefined();
          expect(result.threadId).toBe('thread-1');
          expect(result.hasReplies).toBe(false); // Assuming current time is far after the message date
      });
    });
  
    // --- Tests for ManageLabelsTool ---
    describe('ManageLabelsTool', () => {
      it('should create a new label', async () => {
          mockGmailClient.users.labels.create.mockResolvedValue({
              data: { id: 'label-new', name: 'New Label' },
          });
          const input = { action: 'create' as const, labelName: 'New Label' };
          const result = await ManageLabelsTool.invoke(input, getRunnableConfig(mockGmailConfig));
          expect(result.success).toBe(true);
          expect(result.labelId).toBe('label-new');
          expect(mockGmailClient.users.labels.create).toHaveBeenCalledWith(expect.objectContaining({
              requestBody: expect.objectContaining({ name: 'New Label' }),
          }));
      });
  
      it('should list all labels', async () => {
          mockGmailClient.users.labels.list.mockResolvedValue({
              data: { labels: [{ id: 'label-1', name: 'Work' }, { id: 'label-2', name: 'Personal' }] },
          });
          const input = { action: 'list' as const };
          const result = await ManageLabelsTool.invoke(input, getRunnableConfig(mockGmailConfig));
          expect(result.success).toBe(true);
          expect(result.count).toBe(2);
          expect(result.labels[0].name).toBe('Work');
      });
    });
  
    // --- Tests for GetContactsTool ---
    describe('GetContactsTool', () => {
      it('should extract contacts from email history', async () => {
          mockGmailClient.users.messages.list.mockResolvedValue({
              data: { messages: [{ id: 'msg-contact-1' }] },
          });
          mockGmailClient.users.messages.get.mockResolvedValue({
              data: {
                  internalDate: '1672531200000',
                  payload: {
                      headers: [
                          { name: 'From', value: 'dwivediavichal656@gmail.com' },
                          { name: 'To', value: 'dwivediavichal5@gmail.com, dwivediavichal656@gmail.com' },
                      ],
                  },
              },
          });
  
          const input = { fromEmails: true, emailLimit: 1 };
          const result = await GetContactsTool.invoke(input, getRunnableConfig(mockGmailConfig));
  
          expect(result.success).toBe(true);
          expect(result.count).toBe(2);
          const emails = result.contacts.map((c: any) => c.email);
          expect(emails).toContain('dwivediavichal656@gmail.com');
          expect(emails).toContain('dwivediavichal5@gmail.com');
      });
    });
  });
  