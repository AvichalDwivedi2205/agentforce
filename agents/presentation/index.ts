// Presentation Generation using Google Gemini 2.5 Flash
import { GoogleGenerativeAI } from "@google/generative-ai";
import { PRESENTATION_SYSTEM_PROMPT } from "./prompt.js";

// Initialize Gemini API
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY || '');

// Helper function to generate presentation from research markdown
export async function generatePresentation(researchContent: string): Promise<string> {
  const MAX_RETRIES = 3;
  let lastError: Error | null = null;
  
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(`Generating presentation with Gemini 2.5 Flash (Attempt ${attempt}/${MAX_RETRIES})...`);
      
      // Get the Gemini model with strict instructions
      const model = genAI.getGenerativeModel({ 
        model: "gemini-2.0-flash-exp",
        generationConfig: {
          temperature: 0.7, // Slightly lower for more consistent output
          maxOutputTokens: 16000,
          topP: 0.95,
          topK: 40,
        },
        systemInstruction: "You are an HTML generator. You MUST return ONLY valid HTML code. Start with <!DOCTYPE html> and end with </html>. NO explanations, NO markdown formatting, NO code blocks, NO text before or after the HTML. Just pure HTML code."
      });

    const prompt = `${PRESENTATION_SYSTEM_PROMPT}

Now, create a comprehensive, content-rich HTML/CSS presentation from the following research content.

CRITICAL REQUIREMENTS:

1. CONTENT DENSITY:
   - Create 15-25 slides (more for longer research)
   - Include ALL important data, statistics, and findings
   - Use multi-column layouts to fit more content
   - Don't oversimplify - be thorough and detailed
   - Each slide should have substantial information

2. DATA VISUALIZATIONS (MUST INCLUDE):
   - For any percentages: Create CSS bar charts or pie charts
   - For comparisons: Create side-by-side visual comparisons
   - For trends: Create line graph representations using CSS/SVG
   - For statistics: Create number cards with visual progress bars
   - For categories: Create icon grids or tag clouds
   - For timelines: Create visual timeline with connected points

3. VISUAL ELEMENTS (REQUIRED):
   - Use Unicode icons: 📊 💡 🎯 ⚡ ✓ ★ ◆ ▶ ● ► ✦ ⬆ ⬇ → ← ↑ ↓
   - Add geometric shapes (circles, triangles) as decorative elements
   - Use gradient backgrounds for emphasis
   - Create callout boxes with borders and shadows
   - Add visual separators and dividers
   - Use color-coded sections

4. CHART EXAMPLES TO IMPLEMENT (Use These Styles):
   
   CSS Bar Chart:
   - Horizontal bars with neon glow effect
   - Background: rgba(255,255,255,0.1) 
   - Fill: linear-gradient(90deg, #00D9FF, #9D4EDD)
   - Border radius: 8px
   - Height: 24px
   
   CSS Pie Chart:
   - Circular with conic-gradient
   - Colors: #00D9FF, #9D4EDD, #39FF14, #FF006E
   - Size: 200px with centered text
   - Box-shadow for glow effect
   
   Progress Bars:
   - Full width with gradient fill
   - Background: rgba(255,255,255,0.1)
   - Fill: linear-gradient(90deg, #00D9FF, #9D4EDD)
   - Height: 12px, border-radius: 6px

5. LAYOUT PATTERNS:
   - Hero slide: Full-screen title with background graphics
   - Two-column: Content left, visuals right
   - Three-column: Stats cards or comparison grids
   - Grid layout: 2x2 or 3x3 for multiple points
   - Timeline: Horizontal or vertical with connectors
   - Full-data: Tables, charts, and numbers

6. INTERACTIVITY:
   - Arrow key navigation (←→)
   - Click on slide numbers to jump
   - Space bar to advance
   - Home/End keys for first/last slide
   - Progress bar at top or bottom
   - Slide counter (e.g., "5 / 20")

7. DESIGN REQUIREMENTS (CRITICAL):
   - BLACK BACKGROUND: Pure black (#000000) for all slides
   - Use vibrant accent colors: Electric Blue (#00D9FF), Neon Purple (#9D4EDD), Bright Green (#39FF14)
   - Modern sans-serif fonts (18-20px body, 36-52px headings)
   - CENTERING: All content must be vertically and horizontally centered using Flexbox
   - Consistent padding: 3rem on all sides
   - Text alignment: center for headers, left-align for body content in centered containers
   - Maximum content width: 1200px centered in viewport
   - Box shadows for cards: 0 8px 32px rgba(0, 217, 255, 0.2)
   - Smooth transitions: 0.4s ease-in-out
   - High contrast: White text (#FFFFFF) on black background
   - Responsive: Works perfectly on mobile, tablet, desktop

8. CONTENT STRUCTURE:
   - Slide 1: Title + Subtitle + Date/Author
   - Slide 2-3: Table of Contents / Overview
   - Slides 4-6: Introduction & Context (with data)
   - Slides 7-15: Main Content (detailed, with visualizations)
   - Slides 16-18: Key Findings (emphasis slides with charts)
   - Slides 19-20: Insights & Analysis
   - Slide 21: Conclusion & Summary
   - Slide 22: Recommendations / Next Steps
   - Slide 23: References / Sources

ABSOLUTELY CRITICAL - STYLING & LAYOUT:

SLIDE CONTAINER (Every slide MUST use this structure):
- Each slide: display: flex; align-items: center; justify-content: center;
- Min-height: 100vh; background: #000000;
- Padding: 3rem;

CONTENT WRAPPER (Inside each slide):
- Max-width: 1200px; margin: 0 auto;
- Display: flex; flex-direction: column;
- Align-items: center for centered content
- Align-items: flex-start for left-aligned content within centered container

TEXT STYLING:
- All headings: color: #FFFFFF; text-align: center; margin-bottom: 2rem;
- H1: font-size: 3.5rem; font-weight: 700; letter-spacing: 2px;
- H2: font-size: 2.5rem; font-weight: 600; letter-spacing: 1px;
- H3: font-size: 1.8rem; font-weight: 500;
- Body text: color: #E0E0E0; font-size: 1.1rem; line-height: 1.8;
- Use text-shadow for glow: 0 0 20px rgba(0, 217, 255, 0.5) on headers

PROFESSIONAL SPACING:
- Margin between sections: 2.5rem
- Padding in cards/boxes: 2rem
- Gap in flex containers: 2rem
- Line-height: 1.8 for readability

GLOW EFFECTS:
- Cards: box-shadow: 0 0 30px rgba(0, 217, 255, 0.3)
- Accent elements: border: 2px solid #00D9FF; box-shadow: 0 0 20px rgba(0, 217, 255, 0.4)

ABSOLUTELY CRITICAL - OUTPUT:
- Generate ONLY complete HTML code
- Start with <!DOCTYPE html> and end with </html>
- NO markdown code blocks (no backticks)
- NO explanations before or after the code
- Include ALL CSS in <style> tags
- Include ALL JavaScript in <script> tags
- Make it production-ready and functional
- TEST THE CENTERING: Every slide must be perfectly centered vertically and horizontally

Research Content to Transform:
${researchContent}`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    let html = response.text();
    
    console.log('Gemini raw response received, length:', html.length);
    
    // Aggressive cleaning of markdown artifacts
    html = html.trim();
    
    // Remove markdown code blocks
    html = html.replace(/^```html\s*/i, '');
    html = html.replace(/^```\s*/i, '');
    html = html.replace(/\s*```\s*$/g, '');
    
    // Remove any text before DOCTYPE
    const doctypeIndex = html.indexOf('<!DOCTYPE');
    if (doctypeIndex > 0) {
      console.log(`Removing ${doctypeIndex} characters before DOCTYPE`);
      html = html.substring(doctypeIndex);
    } else if (doctypeIndex === -1) {
      // Try to find <html> tag if DOCTYPE is missing
      const htmlStartIndex = html.toLowerCase().indexOf('<html');
      if (htmlStartIndex > 0) {
        console.log(`No DOCTYPE found, starting from <html> tag`);
        html = '<!DOCTYPE html>\n' + html.substring(htmlStartIndex);
      } else if (htmlStartIndex === -1) {
        console.error('No valid HTML structure found in response');
        console.error('First 500 chars:', html.substring(0, 500));
        throw new Error('Generated content does not contain valid HTML structure');
      }
    }
    
    // Remove any text after closing </html>
    const htmlEndIndex = html.lastIndexOf('</html>');
    if (htmlEndIndex > 0) {
      const afterHtml = html.substring(htmlEndIndex + 7).trim();
      if (afterHtml.length > 0) {
        console.log(`Removing ${afterHtml.length} characters after </html>`);
        html = html.substring(0, htmlEndIndex + 7);
      }
    } else {
      console.error('No closing </html> tag found');
      console.error('Last 500 chars:', html.substring(Math.max(0, html.length - 500)));
      throw new Error('Generated content does not have closing </html> tag');
    }
    
    // Final validation
    html = html.trim();
    
    const hasDoctype = html.toLowerCase().includes('<!doctype html>');
    const hasHtmlStart = html.toLowerCase().includes('<html');
    const hasHtmlEnd = html.toLowerCase().includes('</html>');
    const hasHead = html.toLowerCase().includes('<head>');
    const hasBody = html.toLowerCase().includes('<body>');
    
    if (!hasDoctype || !hasHtmlStart || !hasHtmlEnd || !hasHead || !hasBody) {
      console.error('HTML validation failed:');
      console.error(`- Has DOCTYPE: ${hasDoctype}`);
      console.error(`- Has <html>: ${hasHtmlStart}`);
      console.error(`- Has </html>: ${hasHtmlEnd}`);
      console.error(`- Has <head>: ${hasHead}`);
      console.error(`- Has <body>: ${hasBody}`);
      console.error('First 1000 chars:', html.substring(0, 1000));
      throw new Error('Generated content is not a valid HTML document');
    }
    
      console.log('✓ Presentation HTML validated successfully');
      console.log(`✓ Final HTML length: ${html.length} characters`);
      return html;
      
    } catch (error: any) {
      console.error(`Attempt ${attempt} failed:`, error.message);
      lastError = error;
      
      if (attempt < MAX_RETRIES) {
        console.log(`Retrying in 2 seconds...`);
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
  }
  
  // All retries failed
  console.error('All generation attempts failed');
  throw new Error(`Failed to generate presentation after ${MAX_RETRIES} attempts: ${lastError?.message}`);
}

// Legacy exports for compatibility
export const createPresentationAgent = () => {
  throw new Error('Direct agent creation is deprecated. Use generatePresentation() instead.');
};

export const PresentationAgentTool = null;
export const presentationAgent = null;
