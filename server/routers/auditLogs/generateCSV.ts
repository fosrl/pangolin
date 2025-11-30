export function generateCSV(data: any[]): string {
    if (data.length === 0) {
        return "orgId,action,actorType,timestamp,actor\n";
    }
    
    const headers = Object.keys(data[0]).join(",");
    const rows = data.map(row => 
        Object.values(row).map(value => 
            typeof value === 'string' && value.includes(',') 
                ? `"${value.replace(/"/g, '""')}"` 
                : value
        ).join(",")
    );
    
    return [headers, ...rows].join("\n");
}