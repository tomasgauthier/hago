import { ToolDefinition } from '../registry.js';
import Database from 'better-sqlite3';
import { z } from 'zod';

export function createFinanceTools(db: Database.Database, vaultPath: string): ToolDefinition[] {
    // Initialize transactions table
    db.exec(`
        CREATE TABLE IF NOT EXISTS transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_session TEXT NOT NULL,
            amount REAL NOT NULL,
            currency TEXT DEFAULT 'ARS',
            type TEXT NOT NULL CHECK(type IN ('expense', 'income')),
            category TEXT NOT NULL,
            description TEXT,
            date TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date);
        CREATE INDEX IF NOT EXISTS idx_transactions_session ON transactions(user_session);
    `);

    const logTransaction: ToolDefinition = {
        name: 'log_transaction',
        description: 'Log an expense or income transaction. Understands both English and Spanish (e.g., "gasté $500 en comida" or "I spent $50 on food"). Automatically detects amounts, categories, and descriptions from natural language.',
        parameters: z.object({
            amount: z.number().describe('The transaction amount (positive number)'),
            type: z.enum(['expense', 'income']).describe('Whether this is an expense (gasto) or income (ingreso)'),
            category: z.string().describe('Category like: food/comida, transport/transporte, entertainment/entretenimiento, health/salud, work/trabajo, etc.'),
            description: z.string().optional().describe('Optional description of the transaction'),
            currency: z.string().optional().describe('Currency code (ARS, USD, EUR, etc.)'),
            date: z.string().optional().describe('Date in YYYY-MM-DD format (defaults to today)')
        }),
        execute: async (args: any) => {
            const { amount, type, category, description, currency = 'ARS', date } = args;
            const sessionKey = 'default'; // Will be enhanced later with context
            const transactionDate = date || new Date().toISOString().split('T')[0];

            const stmt = db.prepare(`
                INSERT INTO transactions (user_session, amount, currency, type, category, description, date)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `);

            stmt.run(sessionKey, amount, currency, type, category, description || null, transactionDate);

            // Get monthly total for this category
            const monthStart = transactionDate.substring(0, 7) + '-01';
            const monthTotal = db.prepare(`
                SELECT SUM(amount) as total
                FROM transactions
                WHERE user_session = ? AND category = ? AND type = ? AND date >= ?
            `).get(sessionKey, category, type, monthStart) as any;

            const typeLabel = type === 'expense' ? 'gasto' : 'ingreso';
            return `✅ ${typeLabel.charAt(0).toUpperCase() + typeLabel.slice(1)} registrado: ${currency} $${amount.toLocaleString('es-AR')} en ${category}${description ? ` (${description})` : ''} el ${transactionDate}.\n\nTotal en ${category} este mes: ${currency} $${(monthTotal?.total || 0).toLocaleString('es-AR')}`;
        }
    };

    const getSpendingSummary: ToolDefinition = {
        name: 'get_spending_summary',
        description: 'Get a spending summary for a time period. Works in English and Spanish (e.g., "cuánto gasté esta semana" or "how much did I spend this month").',
        parameters: z.object({
            period: z.enum(['today', 'week', 'month', 'year']).describe('Time period to summarize (hoy/today, semana/week, mes/month, año/year)'),
            category: z.string().optional().describe('Optional: filter by specific category'),
            type: z.enum(['expense', 'income', 'both']).optional().describe('Filter by transaction type (default: expense)')
        }),
        execute: async (args: any) => {
            const { period, category, type = 'expense' } = args;
            const sessionKey = 'default'; // Will be enhanced later with context

            const now = new Date();
            let startDate: string;

            switch (period) {
                case 'today':
                    startDate = now.toISOString().split('T')[0];
                    break;
                case 'week':
                    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                    startDate = weekAgo.toISOString().split('T')[0];
                    break;
                case 'month':
                    startDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
                    break;
                case 'year':
                    startDate = `${now.getFullYear()}-01-01`;
                    break;
                default:
                    startDate = now.toISOString().split('T')[0];
            }

            let query = `
                SELECT 
                    category,
                    SUM(amount) as total,
                    COUNT(*) as count,
                    currency
                FROM transactions
                WHERE user_session = ? AND date >= ?
            `;

            const params: any[] = [sessionKey, startDate];

            if (type !== 'both') {
                query += ` AND type = ?`;
                params.push(type);
            }

            if (category) {
                query += ` AND category = ?`;
                params.push(category);
            }

            query += ` GROUP BY category, currency ORDER BY total DESC`;

            const results = db.prepare(query).all(...params) as any[];

            if (results.length === 0) {
                return `No hay transacciones registradas para este período. 📊`;
            }

            const totalAmount = results.reduce((sum, r) => sum + r.total, 0);
            const totalCount = results.reduce((sum, r) => sum + r.count, 0);

            let summary = `📊 **Resumen de ${period === 'today' ? 'hoy' : period === 'week' ? 'esta semana' : period === 'month' ? 'este mes' : 'este año'}**\n\n`;
            summary += `Total: ${results[0].currency} $${totalAmount.toLocaleString('es-AR')} en ${totalCount} transacciones\n\n`;
            summary += `**Por categoría:**\n`;

            results.forEach(r => {
                const percentage = ((r.total / totalAmount) * 100).toFixed(1);
                summary += `• ${r.category}: ${r.currency} $${r.total.toLocaleString('es-AR')} (${percentage}%) - ${r.count} transacciones\n`;
            });

            return summary;
        }
    };

    return [logTransaction, getSpendingSummary];
}
