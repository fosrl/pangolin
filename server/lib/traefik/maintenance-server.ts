import express from 'express';
import { db, resources } from '@server/db';
import { eq } from 'drizzle-orm';
import { generateMaintenanceHTML } from './getTraefikConfig';
import config from '@server/lib/config';
import logger from '@server/logger';
import path from 'path';
import fs from 'fs';

const MAINTENANCE_DIR = path.join(process.cwd(), 'maintenance-pages');

if (!fs.existsSync(MAINTENANCE_DIR)) {
    fs.mkdirSync(MAINTENANCE_DIR, { recursive: true });
}

export async function generateMaintenanceFiles() {
    logger.info('Regenerating maintenance page files');

    const maintenanceResources = await db
        .select()
        .from(resources)
        .where(eq(resources.maintenanceModeEnabled, true));
    
    // Clear old files
    const files = fs.readdirSync(MAINTENANCE_DIR);
    files.forEach(file => {
        if (file.startsWith('maintenance-')) {
            fs.unlinkSync(path.join(MAINTENANCE_DIR, file));
        }
    });
    
    // Generate new files
    for (const resource of maintenanceResources) {
        if (resource.fullDomain && resource.http) {
            const html = generateMaintenanceHTML(
                resource.maintenanceTitle,
                resource.maintenanceMessage,
                resource.maintenanceEstimatedTime
            );
            
            const filename = `maintenance-${resource.fullDomain}.html`;
            const filepath = path.join(MAINTENANCE_DIR, filename);
            
            fs.writeFileSync(filepath, html, 'utf-8');
            logger.info(`Generated maintenance page: ${filename}`);
        }
    }
}

export function startMaintenanceServer() {
    const app = express();
   
    app.use(express.static(MAINTENANCE_DIR, {
        setHeaders: (res) => {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
        }
    }));
    

    app.use(async (req, res) => {
        const host = req.headers.host;
        
        if (!host) {
            return res.status(400).send("Missing Host header");
        }
        
        const maintenanceFile = path.join(MAINTENANCE_DIR, `maintenance-${host}.html`);
        
        if (fs.existsSync(maintenanceFile)) {
            res.status(503)
                .header('Content-Type', 'text/html; charset=utf-8')
                .header('Retry-After', '3600')
                .sendFile(maintenanceFile);
        } else {
            try {
                const [resource] = await db
                    .select()
                    .from(resources)
                    .where(eq(resources.fullDomain, host));
                
                if (resource?.maintenanceModeEnabled) {
                    const html = generateMaintenanceHTML(
                        resource.maintenanceTitle,
                        resource.maintenanceMessage,
                        resource.maintenanceEstimatedTime
                    );
                    
                    return res.status(503)
                        .header('Content-Type', 'text/html; charset=utf-8')
                        .header('Retry-After', '3600')
                        .send(html);
                }
            } catch (error) {
                logger.error(`Error serving maintenance page: ${error}`);
            }
            
            res.status(404).send('Not found');
        }
    });

    const port = config.getRawConfig().traefik?.maintenance_port || 8888;
    
    app.listen(port, '0.0.0.0', () => {
        logger.info(`Maintenance server listening on ${port}`);
        
        generateMaintenanceFiles().catch(err => {
            logger.error(`Failed to generate initial maintenance files: ${err}`);
        });
    });
}