const { supabase } = require('./supabaseClient');

class ReminderScheduler {
  constructor() {
    this.scheduledJobs = new Map();
    console.log('ReminderScheduler initialized');
  }

  calculateReminderTimes(meetingDateTime) {
    const meetingTime = new Date(meetingDateTime);
    const r1Time = new Date(meetingTime.getTime() - 24 * 60 * 60 * 1000); // 24 hours before
    const r2Time = new Date(meetingTime.getTime() - 60 * 60 * 1000); // 1 hour before
    
    return { r1Time, r2Time, meetingTime };
  }

  async sendReminder(phone, parentsName, meetingDate, meetingTime, reminderType, leadId, fieldType) {
    try {
      console.log(`Sending ${reminderType} reminder for lead ${leadId} (${fieldType})`);
      
      const response = await fetch('https://backend.aisensy.com/campaign/t1/api/v2', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          apiKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY4MGYyOGY2ZTBjYzg1MGMwMmMzNGJiOCIsIm5hbWUiOiJXRUJVWlogRGlnaXRhbCBQcml2YXRlIExpbWl0ZWQiLCJhcHBOYW1lIjoiQWlTZW5zeSIsImNsaWVudElkIjoiNjgwZjI4ZjZlMGNjODUwYzAyYzM0YmIzIiwiYWN0aXZlUGxhbiI6IkZSRUVfRk9SRVZFUiIsImlhdCI6MTc0NTgyMzk5MH0.pJi8qbYf3joYbNm5zSs4gJKFlBFsCS6apvkBkw4Qdxs',
          campaignName: 'schedule100',
          destination: phone,
          userName: parentsName,
          templateParams: [meetingDate, meetingTime]
        })
      });

      if (!response.ok) {
        throw new Error(`API call failed: ${response.status}`);
      }

      const result = await response.json();
      console.log(`${reminderType} reminder sent successfully for lead ${leadId}:`, result);

      // Update database status
      const statusField = fieldType === 'meeting' 
        ? (reminderType === 'R1' ? 'stage2_r1' : 'stage2_r2')
        : (reminderType === 'R1' ? 'stage7_r1' : 'stage7_r2');

      const { error: updateError } = await supabase
        .from('leads')
        .update({ 
          [statusField]: 'SENT',
          updated_at: new Date().toISOString()
        })
        .eq('id', leadId);

      if (updateError) {
        console.error('Error updating status in database:', updateError);
      } else {
        console.log(`Database updated: ${statusField} = SENT for lead ${leadId}`);
      }

      return result;
    } catch (error) {
      console.error(`Error sending ${reminderType} reminder for lead ${leadId}:`, error);
      throw error;
    }
  }

  scheduleReminders(leadId, phone, parentsName, meetingDate, meetingTime, fieldType = 'meeting') {
    console.log(`Scheduling reminders for lead ${leadId} (${fieldType})`);
    
    // Cancel existing reminders for this lead
    this.cancelReminders(leadId, fieldType);

    const meetingDateTime = `${meetingDate}T${meetingTime}:00`;
    const { r1Time, r2Time } = this.calculateReminderTimes(meetingDateTime);

    const now = new Date();

    // Schedule R1 (24 hours before)
    if (r1Time > now) {
      const r1Job = this.scheduleJob(r1Time, async () => {
        console.log(`Executing R1 reminder for lead ${leadId}`);
        try {
          await this.sendReminder(phone, parentsName, meetingDate, meetingTime, 'R1', leadId, fieldType);
        } catch (error) {
          console.error(`Failed to send R1 reminder for lead ${leadId}:`, error);
        }
      });

      const jobKey = `${leadId}_${fieldType}_r1`;
      this.scheduledJobs.set(jobKey, r1Job);
      console.log(`✓ R1 reminder scheduled for lead ${leadId} at ${r1Time.toISOString()}`);
    } else {
      console.log(`⚠ R1 time already passed for lead ${leadId} (${fieldType})`);
    }

    // Schedule R2 (1 hour before)
    if (r2Time > now) {
      const r2Job = this.scheduleJob(r2Time, async () => {
        console.log(`Executing R2 reminder for lead ${leadId}`);
        try {
          await this.sendReminder(phone, parentsName, meetingDate, meetingTime, 'R2', leadId, fieldType);
        } catch (error) {
          console.error(`Failed to send R2 reminder for lead ${leadId}:`, error);
        }
      });

      const jobKey = `${leadId}_${fieldType}_r2`;
      this.scheduledJobs.set(jobKey, r2Job);
      console.log(`✓ R2 reminder scheduled for lead ${leadId} at ${r2Time.toISOString()}`);
    } else {
      console.log(`⚠ R2 time already passed for lead ${leadId} (${fieldType})`);
    }
  }

  scheduleJob(targetTime, callback) {
    const delay = targetTime.getTime() - Date.now();
    
    if (delay <= 0) {
      console.log('Target time already passed, not scheduling');
      return null;
    }

    return setTimeout(callback, delay);
  }

  cancelReminders(leadId, fieldType = 'meeting') {
    const r1Key = `${leadId}_${fieldType}_r1`;
    const r2Key = `${leadId}_${fieldType}_r2`;

    if (this.scheduledJobs.has(r1Key)) {
      clearTimeout(this.scheduledJobs.get(r1Key));
      this.scheduledJobs.delete(r1Key);
      console.log(`Cancelled R1 reminder for lead ${leadId} (${fieldType})`);
    }

    if (this.scheduledJobs.has(r2Key)) {
      clearTimeout(this.scheduledJobs.get(r2Key));
      this.scheduledJobs.delete(r2Key);
      console.log(`Cancelled R2 reminder for lead ${leadId} (${fieldType})`);
    }
  }

  async loadPendingReminders() {
    try {
      console.log('Loading pending reminders from database...');
      
      const { data: leads, error } = await supabase
        .from('leads')
        .select('id, phone, parents_name, meet_datetime, visit_datetime, stage2_r1, stage2_r2, stage7_r1, stage7_r2')
        .or('meet_datetime.not.is.null,visit_datetime.not.is.null');

      if (error) throw error;

      let meetingCount = 0;
      let visitCount = 0;

      leads.forEach(lead => {
        // Schedule meeting reminders
        if (lead.meet_datetime) {
          const meetDateTime = new Date(lead.meet_datetime);
          const meetingDate = meetDateTime.toISOString().split('T')[0];
          const meetingTime = meetDateTime.toTimeString().slice(0, 5);

          // Only schedule if not already sent
          if (lead.stage2_r1 !== 'SENT' || lead.stage2_r2 !== 'SENT') {
            this.scheduleReminders(lead.id, lead.phone, lead.parents_name, meetingDate, meetingTime, 'meeting');
            meetingCount++;
          }
        }

        // Schedule visit reminders
        if (lead.visit_datetime) {
          const visitDateTime = new Date(lead.visit_datetime);
          const visitDate = visitDateTime.toISOString().split('T')[0];
          const visitTime = visitDateTime.toTimeString().slice(0, 5);

          // Only schedule if not already sent
          if (lead.stage7_r1 !== 'SENT' || lead.stage7_r2 !== 'SENT') {
            this.scheduleReminders(lead.id, lead.phone, lead.parents_name, visitDate, visitTime, 'visit');
            visitCount++;
          }
        }
      });

      console.log(`✓ Loaded pending reminders:`);
      console.log(`  - ${meetingCount} meeting reminders`);
      console.log(`  - ${visitCount} visit reminders`);
      console.log(`  - Total leads processed: ${leads.length}`);
    } catch (error) {
      console.error('Error loading pending reminders:', error);
    }
  }
}

module.exports = new ReminderScheduler();
