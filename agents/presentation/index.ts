// Presentation Generation using Google Gemini 2.5 Flash
import { GoogleGenerativeAI } from "@google/generative-ai";
import { PRESENTATION_SYSTEM_PROMPT } from "./prompt.js";

// Initialize Gemini API
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY || '');

// Helper function to generate presentation from research markdown
export async function generatePresentation(researchContent: string): Promise<string> {
  try {
    console.log('Generating presentation with Gemini 2.5 Flash...');
    
    // Get the Gemini model
    const model = genAI.getGenerativeModel({ 
      model: "gemini-2.0-flash-exp",
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 8000,
      }
    });

    const prompt = `${PRESENTATION_SYSTEM_PROMPT}

Now, create a professional, visually appealing HTML/CSS presentation from the following research content.

REQUIREMENTS:
- Create a complete, self-contained HTML file
- Include a compelling title slide
- Break content into multiple slides (one key point per slide)
- Use modern CSS with gradients, shadows, and animations
- Add navigation controls (arrow keys and clickable buttons)
- Include smooth transitions between slides
- Make it fully responsive
- Use a professional color scheme (dark theme with accent colors)
- Add slide numbers/progress indicator

IMPORTANT: 
- Generate ONLY the complete HTML code
- Start with <!DOCTYPE html>
- Include all CSS in <style> tags
- Include all JavaScript in <script> tags
- Do NOT include markdown code blocks (no \`\`\`html)
- Do NOT add any explanations before or after the HTML

Research Content:
${researchContent}`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    let html = response.text();
    
    console.log('Gemini response received, length:', html.length);
    
    // Clean up any markdown code blocks if present
    html = html.replace(/```html\n?/g, '').replace(/```\n?/g, '').trim();
    
    // Remove any leading/trailing explanatory text
    const doctypeIndex = html.indexOf('<!DOCTYPE');
    if (doctypeIndex > 0) {
      html = html.substring(doctypeIndex);
    }
    
    // Remove any text after closing </html>
    const htmlEndIndex = html.lastIndexOf('</html>');
    if (htmlEndIndex > 0) {
      html = html.substring(0, htmlEndIndex + 7);
    }
    
    // Validate HTML structure
    if (!html.includes('<!DOCTYPE html>') || !html.includes('</html>')) {
      console.error('Invalid HTML generated');
      throw new Error('Generated content is not a valid HTML document');
    }
    
    console.log('Presentation generated successfully');
    return html;
    
  } catch (error: any) {
    console.error('Gemini API error:', error);
    throw new Error(`Failed to generate presentation: ${error.message}`);
  }
}

// Legacy exports for compatibility
export const createPresentationAgent = () => {
  throw new Error('Direct agent creation is deprecated. Use generatePresentation() instead.');
};

export const PresentationAgentTool = null;
export const presentationAgent = null;
