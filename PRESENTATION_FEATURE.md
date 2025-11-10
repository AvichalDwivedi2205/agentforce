# Presentation Generation Feature

## Overview
The presentation agent is a new AI-powered feature that transforms research reports into beautiful, interactive HTML/CSS presentations.

## Features

### 1. Presentation Agent
- **Location**: `agents/presentation/`
- **Purpose**: Converts markdown research content into professional HTML/CSS slide decks
- **AI Model**: Claude 3.5 Sonnet (optimized for creative HTML/CSS generation)
- **Temperature**: 0.7 (higher creativity for design)

### 2. Key Capabilities
- ✨ **Automatic Slide Generation**: Converts research reports into structured slides
- 🎨 **Modern Design**: Professional, responsive designs with CSS animations
- 🖱️ **Interactive Navigation**: Keyboard controls and navigation buttons
- 📱 **Responsive**: Works on all screen sizes
- 🎯 **Self-Contained**: Complete HTML files with embedded CSS and JavaScript

### 3. User Interface Features

#### Research Results Page
After completing a research task, users now see additional buttons:

1. **Generate Presentation** - Converts the current research into a presentation
2. **View All Presentations** - Opens a modal showing all previously generated presentations
3. **View Presentation** - Opens the newly generated presentation in a new tab

#### Presentation Modal
- Grid view of all generated presentations
- Timestamp information for each presentation
- Quick access to view any presentation
- Clean, modern design matching the app theme

### 4. API Endpoints

#### Generate Presentation
```
POST /api/generate-presentation
Content-Type: application/json

{
  "markdown": "# Research Report\n\n..."
}

Response:
{
  "success": true,
  "filename": "presentation-2025-11-11T12-00-00.html",
  "html": "<!DOCTYPE html>..."
}
```

#### List Presentations
```
GET /api/presentations

Response:
{
  "presentations": [
    {
      "filename": "presentation-2025-11-11T12-00-00.html",
      "url": "/presentations/presentation-2025-11-11T12-00-00.html",
      "timestamp": "2025-11-11T12-00-00"
    }
  ]
}
```

#### View Presentation
```
GET /presentations/:filename

Returns: HTML content
```

### 5. File Storage
- Presentations are saved in the `generated_files/` directory
- Naming convention: `presentation-{ISO_TIMESTAMP}.html`
- Files are fully self-contained and can be shared independently

## Usage Flow

1. **Conduct Research**: Use the research agent to generate a report
2. **Generate Presentation**: Click "Generate Presentation" button
3. **Wait for Processing**: AI agent creates the HTML/CSS presentation (may take 10-30 seconds)
4. **View Result**: Click "View Presentation" to open in a new tab
5. **Access Anytime**: Use "View All Presentations" to see past presentations

## Technical Architecture

### Agent Structure
```
agents/presentation/
├── index.ts       # Agent implementation and helper functions
└── prompt.ts      # System prompt for presentation generation
```

### Integration Points
1. **Orchestrator**: Updated to include presentation agent
2. **Server**: New endpoints for generation and viewing
3. **Frontend**: New buttons and modal for user interaction
4. **Styles**: CSS for presentation status and modal

### Prompt Engineering
The presentation agent uses a carefully crafted system prompt that:
- Guides the LLM to create complete, self-contained HTML documents
- Emphasizes modern design principles
- Ensures responsive design
- Includes navigation and interaction
- Maintains professional aesthetics

## Design Decisions

### Why HTML/CSS Presentations?
1. **No Dependencies**: Self-contained files that work anywhere
2. **Fully Customizable**: Complete control over design and functionality
3. **Universal Compatibility**: Works in any modern browser
4. **Easy Sharing**: Single file can be shared via email, cloud, etc.
5. **AI-Generated**: Leverages LLM creativity for unique designs

### Why Separate Agent?
1. **Specialization**: Focused on presentation design and HTML generation
2. **Modularity**: Can be used independently or via orchestrator
3. **Prompt Optimization**: Dedicated prompt for best presentation results
4. **Scalability**: Easy to enhance with additional features

## Future Enhancements

Potential improvements:
- [ ] Theme selection (dark, light, corporate, creative)
- [ ] Template library
- [ ] Export to PDF
- [ ] Embed images and charts
- [ ] Presentation analytics
- [ ] Collaborative editing
- [ ] Version history
- [ ] Custom branding options

## Example Output

A typical generated presentation includes:
- Title slide with research topic
- Overview/agenda slide
- Content slides (one key point per slide)
- Data visualization slides
- Key findings slide
- Conclusion slide
- Sources/references slide
- Navigation controls (arrow keys, buttons)
- Progress indicator
- Smooth transitions and animations

## Testing

To test the feature:
1. Start the server: `pnpm server`
2. Conduct a research query
3. Click "Generate Presentation"
4. View the generated presentation
5. Check "View All Presentations" to see the list

## Dependencies

**Updated:** Now uses Google's Gemini 2.5 Flash for faster, more reliable generation!

- `@google/generative-ai` - Google's Generative AI SDK
- Standard Node.js file system
- Vanilla JavaScript for frontend
- Google API Key (add to `.env`)
