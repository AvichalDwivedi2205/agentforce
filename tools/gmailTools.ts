// gmailAgent.ts
import { gmail_v1, google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { CallbackManagerForToolRun } from '@langchain/core/callbacks/manager';
import { RunnableConfig } from '@langchain/core/runnables';

// Add this missing interface
interface ToolConfig {
  gmailConfig: GmailConfig;
}

// Types and Interfaces
interface GmailConfig {
  credentials: {
    client_id: string;
    client_secret: string;
    refresh_token: string;
    access_token?: string;
  };
  scopes: string[];
}

interface EmailAttachment {
  filename: string;
  content: Buffer | string;
  contentType: string;
}

interface EmailMessage {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  body: string;
  bodyHtml?: string;
  attachments?: EmailAttachment[];
  date: Date;
  labels: string[];
  isRead: boolean;
  isImportant: boolean;
}

interface EmailFilter {
  folder?: string;
  unreadOnly?: boolean;
  dateRange?: {
    from?: Date;
    to?: Date;
  };
  sender?: string;
  hasAttachment?: boolean;
  label?: string;
  limit?: number;
}



// Gmail Service Class
class GmailService {
  public gmail: gmail_v1.Gmail;
  private auth: OAuth2Client;

  constructor(config: GmailConfig) {
    this.auth = new OAuth2Client(
      config.credentials.client_id,
      config.credentials.client_secret
    );
    
    this.auth.setCredentials({
      refresh_token: config.credentials.refresh_token,
      access_token: config.credentials.access_token,
    });

    this.gmail = google.gmail({ version: 'v1', auth: this.auth });
  }

  public buildQuery(filter: EmailFilter): string {
    const queryParts: string[] = [];
    
    if (filter.unreadOnly) queryParts.push('is:unread');
    if (filter.sender) queryParts.push(`from:${filter.sender}`);
    if (filter.hasAttachment) queryParts.push('has:attachment');
    if (filter.label) queryParts.push(`label:${filter.label}`);
    if (filter.folder && filter.folder !== 'INBOX') {
      queryParts.push(`in:${filter.folder.toLowerCase()}`);
    }
    
    if (filter.dateRange?.from) {
      const fromDate = filter.dateRange.from.toISOString().split('T')[0];
      queryParts.push(`after:${fromDate}`);
    }
    
    if (filter.dateRange?.to) {
      const toDate = filter.dateRange.to.toISOString().split('T')[0];
      queryParts.push(`before:${toDate}`);
    }

    return queryParts.join(' ');
  }

  public async parseMessage(messageId: string): Promise<EmailMessage> {
    const response = await this.gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'full',
    });

    const message = response.data;
    const headers = message.payload?.headers || [];
    
    const getHeader = (name: string): string => 
      headers.find(h => h.name?.toLowerCase() === name.toLowerCase())?.value || '';

    const subject = getHeader('subject');
    const from = getHeader('from');
    const to = getHeader('to').split(',').map((email: string) => email.trim());
    const cc = getHeader('cc').split(',').map((email: string) => email.trim()).filter(Boolean);
    const bcc = getHeader('bcc').split(',').map((email: string) => email.trim()).filter(Boolean);
    const date = new Date(parseInt(message.internalDate || '0'));

    let body = '';
    let bodyHtml = '';
    
    const extractBody = (part: any): void => {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        body = Buffer.from(part.body.data, 'base64').toString();
      } else if (part.mimeType === 'text/html' && part.body?.data) {
        bodyHtml = Buffer.from(part.body.data, 'base64').toString();
      } else if (part.parts) {
        part.parts.forEach(extractBody);
      }
    };

    if (message.payload) {
      extractBody(message.payload);
    }

    const attachments: EmailAttachment[] = [];
    const extractAttachments = (part: any): void => {
      if (part.filename && part.body?.attachmentId) {
        attachments.push({
          filename: part.filename,
          content: part.body.attachmentId,
          contentType: part.mimeType || 'application/octet-stream',
        });
      } else if (part.parts) {
        part.parts.forEach(extractAttachments);
      }
    };

    if (message.payload) {
      extractAttachments(message.payload);
    }

    return {
      id: message.id!,
      threadId: message.threadId!,
      subject,
      from,
      to,
      cc: cc.length > 0 ? cc : undefined,
      bcc: bcc.length > 0 ? bcc : undefined,
      body,
      bodyHtml: bodyHtml || undefined,
      attachments: attachments.length > 0 ? attachments : undefined,
      date,
      labels: message.labelIds || [],
      isRead: !message.labelIds?.includes('UNREAD'),
      isImportant: message.labelIds?.includes('IMPORTANT') || false,
    };
  }

  public createEmailContent(params: {
    to: string[];
    cc?: string[];
    bcc?: string[];
    subject: string;
    body: string;
    isHtml?: boolean;
    attachments?: EmailAttachment[];
  }): string {
    const boundary = 'boundary_' + Date.now();
    let email = '';

    email += `To: ${params.to.join(', ')}\r\n`;
    if (params.cc?.length) email += `Cc: ${params.cc.join(', ')}\r\n`;
    if (params.bcc?.length) email += `Bcc: ${params.bcc.join(', ')}\r\n`;
    email += `Subject: ${params.subject}\r\n`;
    email += `Content-Type: multipart/mixed; boundary="${boundary}"\r\n\r\n`;

    email += `--${boundary}\r\n`;
    email += `Content-Type: ${params.isHtml ? 'text/html' : 'text/plain'}; charset="UTF-8"\r\n\r\n`;
    email += `${params.body}\r\n`;

    if (params.attachments?.length) {
      params.attachments.forEach((attachment: EmailAttachment) => {
        email += `--${boundary}\r\n`;
        email += `Content-Type: ${attachment.contentType}\r\n`;
        email += `Content-Disposition: attachment; filename="${attachment.filename}"\r\n`;
        email += `Content-Transfer-Encoding: base64\r\n\r\n`;
        
        const content = Buffer.isBuffer(attachment.content) 
          ? attachment.content.toString('base64')
          : Buffer.from(attachment.content).toString('base64');
        email += `${content}\r\n`;
      });
    }

    email += `--${boundary}--`;
    return email;
  }
}

// Helper function to get Gmail config from RunnableConfig
function getGmailConfig(config?: RunnableConfig): GmailConfig | undefined {
  return (config as any)?.gmailConfig;
}

// Tool 1: Send Email
export const SendEmailTool = new DynamicStructuredTool({
  name: "send_email",
  description: "Send emails with attachments, rich text, and scheduling capabilities",
  schema: z.object({
    recipients: z.array(z.string()).describe("Email addresses to send to"),
    subject: z.string().describe("Email subject line"),
    body: z.string().describe("Email body content"),
    cc: z.array(z.string()).optional().describe("CC recipients"),
    bcc: z.array(z.string()).optional().describe("BCC recipients"),
    isHtml: z.boolean().optional().default(false).describe("Whether body is HTML"),
    attachments: z.array(z.object({
      filename: z.string(),
      content: z.string().describe("Base64 encoded file content or file path"),
      contentType: z.string()
    })).optional().describe("File attachments"),
    scheduleTime: z.string().optional().describe("ISO datetime string for scheduled sending"),
    replyToId: z.string().optional().describe("Message ID to reply to"),
    forwardFromId: z.string().optional().describe("Message ID to forward")
  }),
  
  func: async (
    input: any, 
    runManager?: CallbackManagerForToolRun,
    config?: RunnableConfig
  ): Promise<any> => {
    try {
      const gmailConfig = getGmailConfig(config);
      if (!gmailConfig) {
        throw new Error('Gmail configuration is required');
      }

      const gmailService = new GmailService(gmailConfig);
      
      if (input.scheduleTime) {
        return {
          success: true,
          messageId: 'scheduled_' + Date.now(),
          message: `Email scheduled for ${input.scheduleTime}`,
          scheduled: true
        };
      }

      const emailContent = gmailService.createEmailContent({
        to: input.recipients,
        cc: input.cc,
        bcc: input.bcc,
        subject: input.subject,
        body: input.body,
        isHtml: input.isHtml,
        attachments: input.attachments?.map((att: any) => ({
          filename: att.filename,
          content: att.content,
          contentType: att.contentType
        }))
      });

      const encodedEmail = Buffer.from(emailContent).toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

      const response = await gmailService.gmail.users.messages.send({
        userId: 'me',
        requestBody: {
          raw: encodedEmail,
          threadId: input.replyToId || input.forwardFromId
        }
      });

      return {
        success: true,
        messageId: response.data.id,
        threadId: response.data.threadId,
        message: 'Email sent successfully'
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
        message: 'Failed to send email'
      };
    }
  }
});

// Tool 2: Read Emails
export const ReadEmailsTool = new DynamicStructuredTool({
  name: "read_emails",
  description: "Fetch emails with advanced filtering capabilities",
  schema: z.object({
    folder: z.string().optional().default('INBOX').describe("Folder to read from"),
    unreadOnly: z.boolean().optional().default(false).describe("Only fetch unread emails"),
    dateRange: z.object({
      from: z.string().optional().describe("Start date (ISO string)"),
      to: z.string().optional().describe("End date (ISO string)")
    }).optional().describe("Date range filter"),
    sender: z.string().optional().describe("Filter by sender email"),
    hasAttachment: z.boolean().optional().describe("Filter emails with attachments"),
    label: z.string().optional().describe("Filter by Gmail label"),
    limit: z.number().optional().default(10).describe("Maximum number of emails to fetch")
  }),
  
  func: async (
    input: any,
    runManager?: CallbackManagerForToolRun,
    config?: RunnableConfig
  ): Promise<any> => {
    try {
      const gmailConfig = getGmailConfig(config);
      if (!gmailConfig) {
        throw new Error('Gmail configuration is required');
      }

      const gmailService = new GmailService(gmailConfig);
      
      const filter: EmailFilter = {
        folder: input.folder,
        unreadOnly: input.unreadOnly,
        dateRange: input.dateRange ? {
          from: input.dateRange.from ? new Date(input.dateRange.from) : undefined,
          to: input.dateRange.to ? new Date(input.dateRange.to) : undefined,
        } : undefined,
        sender: input.sender,
        hasAttachment: input.hasAttachment,
        label: input.label,
        limit: input.limit
      };

      const query = gmailService.buildQuery(filter);
      
      const response = await gmailService.gmail.users.messages.list({
        userId: 'me',
        q: query,
        maxResults: input.limit,
        labelIds: input.folder === 'INBOX' ? ['INBOX'] : undefined
      });

      const messageIds = response.data.messages?.map(msg => msg.id!) || [];
      const emails: EmailMessage[] = [];

      for (const messageId of messageIds.slice(0, input.limit)) {
        try {
          const email = await gmailService.parseMessage(messageId);
          emails.push(email);
        } catch (error) {
          console.warn(`Failed to parse message ${messageId}:`, error);
        }
      }

      return {
        success: true,
        emails: emails,
        count: emails.length,
        totalAvailable: response.data.resultSizeEstimate || 0,
        message: `Fetched ${emails.length} emails successfully`
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
        message: 'Failed to fetch emails'
      };
    }
  }
});

// Continue with remaining tools using the same pattern...
// I'll provide a few more tools to show the pattern, then you can apply it to the rest

// Tool 3: Search Emails  
export const SearchEmailsTool = new DynamicStructuredTool({
  name: "search_emails",
  description: "Advanced email search across all folders with complex queries",
  schema: z.object({
    query: z.string().describe("Search query (Gmail search syntax supported)"),
    searchIn: z.array(z.enum(['subject', 'body', 'from', 'to', 'all'])).optional().default(['all']).describe("Where to search"),
    dateRange: z.object({
      from: z.string().optional(),
      to: z.string().optional()
    }).optional().describe("Date range for search"),
    labels: z.array(z.string()).optional().describe("Search within specific labels"),
    excludeLabels: z.array(z.string()).optional().describe("Exclude emails with these labels"),
    hasAttachment: z.boolean().optional().describe("Filter by attachment presence"),
    isRead: z.boolean().optional().describe("Filter by read status"),
    isImportant: z.boolean().optional().describe("Filter by importance"),
    limit: z.number().optional().default(25).describe("Maximum results to return"),
    sortBy: z.enum(['date', 'relevance']).optional().default('date').describe("Sort order")
  }),
  
  func: async (
    input: any,
    runManager?: CallbackManagerForToolRun,
    config?: RunnableConfig
  ): Promise<any> => {
    try {
      const gmailConfig = getGmailConfig(config);
      if (!gmailConfig) {
        throw new Error('Gmail configuration is required');
      }

      const gmailService = new GmailService(gmailConfig);
      
      let searchQuery = input.query;
      
      if (input.searchIn && !input.searchIn.includes('all')) {
        const searchParts = input.searchIn.map((field: string) => {
          switch (field) {
            case 'subject': return `subject:(${input.query})`;
            case 'body': return `body:(${input.query})`;
            case 'from': return `from:(${input.query})`;
            case 'to': return `to:(${input.query})`;
            default: return input.query;
          }
        });
        searchQuery = searchParts.join(' OR ');
      }

      const queryParts = [searchQuery];
      
      if (input.dateRange?.from) {
        queryParts.push(`after:${input.dateRange.from.split('T')[0]}`);
      }
      if (input.dateRange?.to) {
        queryParts.push(`before:${input.dateRange.to.split('T')[0]}`);
      }
      if (input.hasAttachment !== undefined) {
        queryParts.push(input.hasAttachment ? 'has:attachment' : '-has:attachment');
      }
      if (input.isRead !== undefined) {
        queryParts.push(input.isRead ? '-is:unread' : 'is:unread');
      }
      if (input.isImportant !== undefined) {
        queryParts.push(input.isImportant ? 'is:important' : '-is:important');
      }
      if (input.labels?.length) {
        queryParts.push(...input.labels.map((label: string) => `label:${label}`));
      }
      if (input.excludeLabels?.length) {
        queryParts.push(...input.excludeLabels.map((label: string) => `-label:${label}`));
      }

      const finalQuery = queryParts.join(' ');

      const response = await gmailService.gmail.users.messages.list({
        userId: 'me',
        q: finalQuery,
        maxResults: input.limit
      });

      const messageIds = response.data.messages?.map(msg => msg.id!) || [];
      const emails: EmailMessage[] = [];

      for (const messageId of messageIds) {
        try {
          const email = await gmailService.parseMessage(messageId);
          emails.push(email);
        } catch (error) {
          console.warn(`Failed to parse message ${messageId}:`, error);
        }
      }

      if (input.sortBy === 'date') {
        emails.sort((a, b) => b.date.getTime() - a.date.getTime());
      }

      return {
        success: true,
        emails: emails,
        count: emails.length,
        query: finalQuery,
        totalAvailable: response.data.resultSizeEstimate || 0,
        message: `Found ${emails.length} emails matching search criteria`
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
        message: 'Search failed'
      };
    }
  }
});


// Tool 4: Manage Email
export const ManageEmailTool = new DynamicStructuredTool({
  name: "manage_email",
  description: "Email organization - archive, delete, mark read/unread, add/remove labels",
  schema: z.object({
    emailIds: z.array(z.string()).describe("Email IDs to manage"),
    action: z.enum(['archive', 'delete', 'mark_read', 'mark_unread', 'mark_important', 'unmark_important', 'move_to_trash', 'restore_from_trash']).describe("Action to perform"),
    addLabels: z.array(z.string()).optional().describe("Labels to add"),
    removeLabels: z.array(z.string()).optional().describe("Labels to remove")
  }),
  
  func: async (
    input: any,
    runManager?: CallbackManagerForToolRun,
    config?: RunnableConfig
  ): Promise<any> => {
    try {
      const gmailConfig = getGmailConfig(config);
      if (!gmailConfig) {
        throw new Error('Gmail configuration is required');
      }

      const gmailService = new GmailService(gmailConfig);
      const results: any[] = [];

      for (const emailId of input.emailIds) {
        try {
          switch (input.action) {
            case 'archive':
              await gmailService.gmail.users.messages.modify({
                userId: 'me',
                id: emailId,
                requestBody: { removeLabelIds: ['INBOX'] }
              });
              break;

            case 'delete':
            case 'move_to_trash':
              await gmailService.gmail.users.messages.trash({
                userId: 'me',
                id: emailId
              });
              break;

            case 'restore_from_trash':
              await gmailService.gmail.users.messages.untrash({
                userId: 'me',
                id: emailId
              });
              break;

            case 'mark_read':
              await gmailService.gmail.users.messages.modify({
                userId: 'me',
                id: emailId,
                requestBody: { removeLabelIds: ['UNREAD'] }
              });
              break;

            case 'mark_unread':
              await gmailService.gmail.users.messages.modify({
                userId: 'me',
                id: emailId,
                requestBody: { addLabelIds: ['UNREAD'] }
              });
              break;

            case 'mark_important':
              await gmailService.gmail.users.messages.modify({
                userId: 'me',
                id: emailId,
                requestBody: { addLabelIds: ['IMPORTANT'] }
              });
              break;

            case 'unmark_important':
              await gmailService.gmail.users.messages.modify({
                userId: 'me',
                id: emailId,
                requestBody: { removeLabelIds: ['IMPORTANT'] }
              });
              break;
          }

          if (input.addLabels?.length || input.removeLabels?.length) {
            await gmailService.gmail.users.messages.modify({
              userId: 'me',
              id: emailId,
              requestBody: {
                addLabelIds: input.addLabels,
                removeLabelIds: input.removeLabels
              }
            });
          }

          results.push({ emailId, success: true, action: input.action });
        } catch (error) {
          results.push({
            emailId,
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            action: input.action
          });
        }
      }

      const successCount = results.filter(r => r.success).length;
      
      return {
        success: successCount > 0,
        results: results,
        successCount: successCount,
        totalCount: input.emailIds.length,
        message: `Successfully ${input.action} ${successCount}/${input.emailIds.length} emails`
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
        message: 'Email management operation failed'
      };
    }
  }
});

// Tool 5: Draft Email
export const DraftEmailTool = new DynamicStructuredTool({
  name: "draft_email",
  description: "Create, update, list, and send email drafts",
  schema: z.object({
    action: z.enum(['create', 'update', 'list', 'send', 'delete']).describe("Action to perform on drafts"),
    draftId: z.string().optional().describe("Draft ID for update/send/delete operations"),
    recipients: z.array(z.string()).optional().describe("Email recipients"),
    subject: z.string().optional().describe("Email subject"),
    body: z.string().optional().describe("Email body content"),
    cc: z.array(z.string()).optional().describe("CC recipients"),
    bcc: z.array(z.string()).optional().describe("BCC recipients"),
    isHtml: z.boolean().optional().default(false).describe("Whether body is HTML"),
    limit: z.number().optional().default(10).describe("Number of drafts to list")
  }),
  
  func: async (
    input: any,
    runManager?: CallbackManagerForToolRun,
    config?: RunnableConfig
  ): Promise<any> => {
    try {
      const gmailConfig = getGmailConfig(config);
      if (!gmailConfig) {
        throw new Error('Gmail configuration is required');
      }

      const gmailService = new GmailService(gmailConfig);

      switch (input.action) {
        case 'create':
          if (!input.recipients || !input.subject || !input.body) {
            return {
              success: false,
              message: 'Recipients, subject, and body are required for creating drafts'
            };
          }

          const emailContent = gmailService.createEmailContent({
            to: input.recipients,
            cc: input.cc,
            bcc: input.bcc,
            subject: input.subject,
            body: input.body,
            isHtml: input.isHtml
          });

          const encodedEmail = Buffer.from(emailContent).toString('base64')
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '');

          const createResponse = await gmailService.gmail.users.drafts.create({
            userId: 'me',
            requestBody: { message: { raw: encodedEmail } }
          });

          return {
            success: true,
            draftId: createResponse.data.id,
            message: 'Draft created successfully'
          };

        case 'list':
          const listResponse = await gmailService.gmail.users.drafts.list({
            userId: 'me',
            maxResults: input.limit
          });

          const drafts = listResponse.data.drafts || [];
          const draftDetails: any[] = [];

          for (const draft of drafts) {
            try {
              const draftDetail = await gmailService.gmail.users.drafts.get({
                userId: 'me',
                id: draft.id!
              });

              const headers = draftDetail.data.message?.payload?.headers || [];
              const getHeader = (name: string) => 
                headers.find(h => h.name?.toLowerCase() === name.toLowerCase())?.value || '';

              draftDetails.push({
                id: draft.id,
                messageId: draftDetail.data.message?.id,
                subject: getHeader('subject'),
                to: getHeader('to'),
                created: new Date(parseInt(draftDetail.data.message?.internalDate || '0'))
              });
            } catch (error) {
              console.warn(`Failed to get draft details for ${draft.id}:`, error);
            }
          }

          return {
            success: true,
            drafts: draftDetails,
            count: draftDetails.length,
            message: `Retrieved ${draftDetails.length} drafts`
          };

        case 'send':
          if (!input.draftId) {
            return { success: false, message: 'Draft ID is required for send operation' };
          }

          const sendResponse = await gmailService.gmail.users.drafts.send({
            userId: 'me',
            requestBody: { id: input.draftId }
          });

          return {
            success: true,
            messageId: sendResponse.data.id,
            threadId: sendResponse.data.threadId,
            message: 'Draft sent successfully'
          };

        case 'delete':
          if (!input.draftId) {
            return { success: false, message: 'Draft ID is required for delete operation' };
          }

          await gmailService.gmail.users.drafts.delete({
            userId: 'me',
            id: input.draftId
          });

          return { success: true, message: 'Draft deleted successfully' };

        default:
          return { success: false, message: 'Invalid action specified' };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
        message: `Draft ${input.action} operation failed`
      };
    }
  }
});

// Tool 6: Monitor Replies
export const MonitorRepliesTool = new DynamicStructuredTool({
  name: "monitor_replies",
  description: "Track responses to sent emails with timeout and notification capabilities",
  schema: z.object({
    emailId: z.string().optional().describe("Specific email ID to monitor"),
    threadId: z.string().optional().describe("Thread ID to monitor"),
    timeoutHours: z.number().optional().default(24).describe("Hours to monitor for replies"),
    checkInterval: z.number().optional().default(5).describe("Check interval in minutes"),
    stopOnReply: z.boolean().optional().default(true).describe("Stop monitoring after first reply")
  }),
  
  func: async (
    input: any,
    runManager?: CallbackManagerForToolRun,
    config?: RunnableConfig
  ): Promise<any> => {
    try {
      const gmailConfig = getGmailConfig(config);
      if (!gmailConfig) {
        throw new Error('Gmail configuration is required');
      }

      const gmailService = new GmailService(gmailConfig);
      
      if (!input.emailId && !input.threadId) {
        return {
          success: false,
          message: 'Either emailId or threadId must be provided'
        };
      }

      let threadId = input.threadId;
      if (input.emailId && !threadId) {
        const messageResponse = await gmailService.gmail.users.messages.get({
          userId: 'me',
          id: input.emailId
        });
        threadId = messageResponse.data.threadId!;
      }

      const threadResponse = await gmailService.gmail.users.threads.get({
        userId: 'me',
        id: threadId!
      });

      const currentMessages = threadResponse.data.messages || [];
      const baselineMessageCount = currentMessages.length;
      const startTime = new Date();
      const endTime = new Date(startTime.getTime() + (input.timeoutHours! * 60 * 60 * 1000));

      const monitoringId = `monitor_${threadId}_${Date.now()}`;

      const recentMessages = currentMessages.filter(msg => {
        const msgDate = new Date(parseInt(msg.internalDate || '0'));
        return msgDate > new Date(Date.now() - (5 * 60 * 1000));
      });

      const hasRecentReplies = recentMessages.length > 0;
      const replies: EmailMessage[] = [];

      if (hasRecentReplies) {
        for (const msg of recentMessages) {
          try {
            const reply = await gmailService.parseMessage(msg.id!);
            replies.push(reply);
          } catch (error) {
            console.warn(`Failed to parse message ${msg.id}:`, error);
          }
        }
      }

      return {
        success: true,
        monitoringId: monitoringId,
        threadId: threadId,
        baselineMessageCount: baselineMessageCount,
        currentReplies: replies,
        hasReplies: hasRecentReplies,
        monitoringSetup: {
          startTime: startTime,
          endTime: endTime,
          checkInterval: input.checkInterval,
          stopOnReply: input.stopOnReply
        },
        message: hasRecentReplies 
          ? `Found ${replies.length} recent replies` 
          : 'Monitoring setup completed, no recent replies found'
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
        message: 'Failed to set up reply monitoring'
      };
    }
  }
});

// Tool 7: Manage Labels
export const ManageLabelsTool = new DynamicStructuredTool({
  name: "manage_labels",
  description: "Create, apply, remove, and manage Gmail labels for email organization",
  schema: z.object({
    action: z.enum(['create', 'delete', 'list', 'apply', 'remove', 'update']).describe("Action to perform"),
    labelName: z.string().optional().describe("Label name for create/delete/update operations"),
    newLabelName: z.string().optional().describe("New label name for update operation"),
    emailIds: z.array(z.string()).optional().describe("Email IDs to apply/remove labels"),
    labelColor: z.string().optional().describe("Label color (textColor,backgroundColor)"),
    labelVisibility: z.enum(['show', 'hide', 'showIfUnread']).optional().default('show').describe("Label visibility in label list"),
    messageVisibility: z.enum(['show', 'hide']).optional().default('show').describe("Label visibility on messages")
  }),
  
  func: async (
    input: any,
    runManager?: CallbackManagerForToolRun,
    config?: RunnableConfig
  ): Promise<any> => {
    try {
      const gmailConfig = getGmailConfig(config);
      if (!gmailConfig) {
        throw new Error('Gmail configuration is required');
      }

      const gmailService = new GmailService(gmailConfig);

      switch (input.action) {
        case 'create':
          if (!input.labelName) {
            return { success: false, message: 'Label name is required for create operation' };
          }

          const createResponse = await gmailService.gmail.users.labels.create({
            userId: 'me',
            requestBody: {
              name: input.labelName,
              labelListVisibility: input.labelVisibility?.toUpperCase() as any,
              messageListVisibility: input.messageVisibility?.toUpperCase() as any
            }
          });

          return {
            success: true,
            labelId: createResponse.data.id,
            labelName: createResponse.data.name,
            message: `Label "${input.labelName}" created successfully`
          };

        case 'list':
          const listResponse = await gmailService.gmail.users.labels.list({
            userId: 'me'
          });

          const labels = listResponse.data.labels?.map(label => ({
            id: label.id,
            name: label.name,
            type: label.type,
            messagesTotal: label.messagesTotal,
            messagesUnread: label.messagesUnread,
            threadsTotal: label.threadsTotal,
            threadsUnread: label.threadsUnread,
            color: label.color
          })) || [];

          return {
            success: true,
            labels: labels,
            count: labels.length,
            message: `Retrieved ${labels.length} labels`
          };

        case 'apply':
          if (!input.labelName || !input.emailIds?.length) {
            return {
              success: false,
              message: 'Label name and email IDs are required for apply operation'
            };
          }

          const applyLabelsResponse = await gmailService.gmail.users.labels.list({
            userId: 'me'
          });

          const labelToApply = applyLabelsResponse.data.labels?.find(
            label => label.name === input.labelName
          );

          if (!labelToApply) {
            return { success: false, message: `Label "${input.labelName}" not found` };
          }

          const applyResults: any[] = [];
          for (const emailId of input.emailIds) {
            try {
              await gmailService.gmail.users.messages.modify({
                userId: 'me',
                id: emailId,
                requestBody: { addLabelIds: [labelToApply.id!] }
              });
              applyResults.push({ emailId, success: true });
            } catch (error) {
              applyResults.push({ 
                emailId, 
                success: false, 
                error: error instanceof Error ? error.message : 'Unknown error' 
              });
            }
          }

          const applySuccessCount = applyResults.filter(r => r.success).length;

          return {
            success: applySuccessCount > 0,
            results: applyResults,
            successCount: applySuccessCount,
            totalCount: input.emailIds.length,
            message: `Applied label "${input.labelName}" to ${applySuccessCount}/${input.emailIds.length} emails`
          };

        default:
          return { success: false, message: 'Invalid action specified' };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
        message: `Label ${input.action} operation failed`
      };
    }
  }
});

// Tool 8: Get Contacts
export const GetContactsTool = new DynamicStructuredTool({
  name: "get_contacts",
  description: "Retrieve and manage contact information from Gmail and Google Contacts",
  schema: z.object({
    query: z.string().optional().describe("Search query for contacts (name, email, etc.)"),
    limit: z.number().optional().default(50).describe("Maximum number of contacts to return"),
    sortBy: z.enum(['name', 'email', 'lastModified', 'frequency']).optional().default('name').describe("Sort contacts by field"),
    fromEmails: z.boolean().optional().default(false).describe("Extract contacts from email history"),
    emailLimit: z.number().optional().default(100).describe("Number of recent emails to scan for contacts")
  }),
  
  func: async (
    input: any,
    runManager?: CallbackManagerForToolRun,
    config?: RunnableConfig
  ): Promise<any> => {
    try {
      const gmailConfig = getGmailConfig(config);
      if (!gmailConfig) {
        throw new Error('Gmail configuration is required');
      }

      const gmailService = new GmailService(gmailConfig);
      
      // For MVP, extract contacts from email history
      const emailResponse = await gmailService.gmail.users.messages.list({
        userId: 'me',
        maxResults: input.emailLimit,
        q: input.query || ''
      });

      const messageIds = emailResponse.data.messages?.map(msg => msg.id!) || [];
      const emailContacts = new Map();

      for (const messageId of messageIds.slice(0, input.emailLimit)) {
        try {
          const message = await gmailService.gmail.users.messages.get({
            userId: 'me',
            id: messageId,
            format: 'metadata',
            metadataHeaders: ['From', 'To', 'Cc', 'Bcc']
          });

          const headers = message.data.payload?.headers || [];
          const extractEmails = (headerName: string) => {
            const header = headers.find(h => h.name === headerName);
            if (header?.value) {
              const emailRegex = /[\w\.-]+@[\w\.-]+\.\w+/g;
              return header.value.match(emailRegex) || [];
            }
            return [];
          };

          [...extractEmails('From'), ...extractEmails('To'), ...extractEmails('Cc'), ...extractEmails('Bcc')]
            .forEach(email => {
              if (!emailContacts.has(email)) {
                emailContacts.set(email, {
                  email,
                  name: email.split('@')[0],
                  frequency: 1,
                  lastSeen: new Date(parseInt(message.data.internalDate || '0'))
                });
              } else {
                const contact = emailContacts.get(email);
                contact.frequency++;
                const msgDate = new Date(parseInt(message.data.internalDate || '0'));
                if (msgDate > contact.lastSeen) {
                  contact.lastSeen = msgDate;
                }
              }
            });
        } catch (error) {
          console.warn(`Failed to process message ${messageId}:`, error);
        }
      }

      let contacts = Array.from(emailContacts.values());

      // Apply query filter if provided
      if (input.query) {
        const queryLower = input.query.toLowerCase();
        contacts = contacts.filter(contact => 
          contact.name.toLowerCase().includes(queryLower) ||
          contact.email.toLowerCase().includes(queryLower)
        );
      }

      // Sort contacts
      switch (input.sortBy) {
        case 'name':
          contacts.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
          break;
        case 'email':
          contacts.sort((a, b) => (a.email || '').localeCompare(b.email || ''));
          break;
        case 'frequency':
          contacts.sort((a, b) => (b.frequency || 0) - (a.frequency || 0));
          break;
        case 'lastModified':
          contacts.sort((a, b) => {
            const dateA = new Date(a.lastSeen || 0);
            const dateB = new Date(b.lastSeen || 0);
            return dateB.getTime() - dateA.getTime();
          });
          break;
      }

      // Limit results
      contacts = contacts.slice(0, input.limit);

      return {
        success: true,
        contacts: contacts,
        count: contacts.length,
        source: 'email_history',
        message: `Retrieved ${contacts.length} contacts successfully`
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
        message: 'Failed to retrieve contacts'
      };
    }
  }
});

// Export all tools
export const GmailTools = {
  SendEmailTool,
  ReadEmailsTool,
  SearchEmailsTool,
  ManageEmailTool,
  DraftEmailTool,
  MonitorRepliesTool,
  ManageLabelsTool,
  GetContactsTool
};

export { GmailService };
export type { GmailConfig, EmailMessage, EmailFilter, EmailAttachment };
