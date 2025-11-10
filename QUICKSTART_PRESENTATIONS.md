# Quick Start Guide - Presentation Feature

## 🚀 Getting Started (30 seconds)

### Step 1: Server is Running ✅
Your server is already running at http://localhost:3000

### Step 2: Try It Out!

1. **Open Browser**: Navigate to http://localhost:3000
2. **Run Research**: Enter a research query (e.g., "Latest AI trends in 2025")
3. **Wait for Results**: Let the research complete
4. **Generate Presentation**: Click the **"Generate Presentation"** button
5. **View**: Click **"View Presentation"** when ready
6. **Explore**: Check out **"View All Presentations"** to see your collection

## 📍 What You'll See

### On Research Completion Page:
```
┌─────────────────────────────────────────────┐
│  Research Report                            │
│  ┌─────────────────────────────────────┐   │
│  │ [Copy Markdown]  [Download]         │   │
│  │ [Generate Presentation] ← NEW!      │   │
│  │ [View All Presentations] ← NEW!     │   │
│  │ [New Research]                      │   │
│  └─────────────────────────────────────┘   │
│                                             │
│  [Report content here...]                  │
│                                             │
│  ┌─────────────────────────────────────┐   │
│  │ ✓ Presentation generated!           │   │
│  │ [View Presentation]                 │   │
│  └─────────────────────────────────────┘   │
└─────────────────────────────────────────────┘
```

### Presentations Modal:
```
┌────────────────────────────────────────┐
│  All Presentations              [×]    │
├────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐   │
│  │ Presentation │  │ Presentation │   │
│  │      1       │  │      2       │   │
│  │ Nov 11, 2025 │  │ Nov 10, 2025 │   │
│  │ [View]       │  │ [View]       │   │
│  └──────────────┘  └──────────────┘   │
└────────────────────────────────────────┘
```

## 🎯 Example Usage

### Example 1: Simple Research → Presentation
```
1. Query: "Benefits of renewable energy"
2. Wait for research to complete
3. Click "Generate Presentation"
4. Wait ~15 seconds
5. Click "View Presentation"
6. Enjoy your HTML slideshow! 🎉
```

### Example 2: View Past Presentations
```
1. Click "View All Presentations"
2. See grid of all presentations
3. Click any "View" button
4. Opens in new tab
```

## 🔍 What Gets Generated?

Each presentation includes:
- 🎯 **Title Slide**: Eye-catching intro
- 📋 **Overview**: Key points at a glance
- 📝 **Content Slides**: Research broken down clearly
- 💡 **Insights**: Key findings highlighted
- 🎨 **Modern Design**: Professional CSS styling
- ⌨️ **Navigation**: Arrow keys + buttons
- 📱 **Responsive**: Works on all devices

## 📁 Where Are Files Saved?

```
agentforce/
└── generated_files/
    ├── presentation-2025-11-11T12-00-00-000Z.html
    ├── presentation-2025-11-11T13-30-15-123Z.html
    └── ...
```

## 🛠️ Troubleshooting

### "Generate Presentation" button not working?
- Make sure research completed successfully
- Check browser console for errors
- Ensure server is running

### Presentation looks broken?
- The AI generates the design - try again for a different style
- Some complex markdown might need simplification

### Server not responding?
```powershell
# Restart server
pnpm run server:dev
```

## 💡 Pro Tips

1. **Better Presentations**: More detailed research → better presentations
2. **Multiple Styles**: Generate multiple times for different designs
3. **Easy Sharing**: Just share the HTML file - it works standalone!
4. **Keyboard Shortcuts**: Use arrow keys to navigate presentations
5. **Mobile Friendly**: View on any device

## 🎨 Customization

The AI automatically:
- Chooses color schemes
- Designs layouts
- Creates animations
- Structures content
- Adds navigation

Each presentation is unique!

## 📊 API Reference (Optional)

### For Developers:

```javascript
// Generate from code
const response = await fetch('/api/generate-presentation', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ 
    markdown: '# Your Research\n\nContent here...' 
  })
});

const { filename, html } = await response.json();

// List all
const list = await fetch('/api/presentations');
const { presentations } = await list.json();

// View specific
window.open(`/presentations/${filename}`, '_blank');
```

## 🎉 That's It!

You're ready to create amazing presentations from your research!

**Happy Presenting! 🚀**
