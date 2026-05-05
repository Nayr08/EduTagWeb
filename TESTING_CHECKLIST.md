# 🧪 EduTag System - Comprehensive Testing Checklist

**Test Date:** ___________  
**Tester Name:** ___________  
**System Version:** ___________

---

## **📋 TABLE OF CONTENTS**
1. [Admin Authentication](#admin-authentication)
2. [Event Management](#event-management)
3. [Student Attendance Scanning](#student-attendance-scanning)
4. [Sanctions Management](#sanctions-management)
5. [Auto-Absent Logic](#auto-absent-logic)
6. [Event Extension & Recalculation](#event-extension--recalculation)
7. [Error Handling](#error-handling)
8. [Edge Cases](#edge-cases)

---

## **1. ADMIN AUTHENTICATION** 🔐

### Test Cases:

| # | Test Case | Steps | Expected Result | Status |
|---|-----------|-------|-----------------|--------|
| 1.1 | Valid Login | Enter admin email & password | Login successful, redirected to admin dashboard | ☐ |
| 1.2 | Invalid Email | Enter wrong email | Error message shown, login fails | ☐ |
| 1.3 | Invalid Password | Enter wrong password | Error message shown, login fails | ☐ |
| 1.4 | Empty Email | Leave email blank, enter password | Error/validation message | ☐ |
| 1.5 | Empty Password | Enter email, leave password blank | Error/validation message | ☐ |
| 1.6 | Both Fields Empty | Click login with empty fields | Error message shown | ☐ |
| 1.7 | Logout | Click logout button | Redirected to login page | ☐ |
| 1.8 | Session Persistence | Login then refresh page | Session maintained, still logged in | ☐ |
| 1.9 | Direct URL Access | Try to access admin page without login | Redirected to login page | ☐ |

---

## **2. EVENT MANAGEMENT** 📅

### Test Cases:

| # | Test Case | Steps | Expected Result | Status |
|---|-----------|-------|-----------------|--------|
| 2.1 | Create Event | Fill all fields: name, date, start time (8:00), end time (8:30), late until (8:45) | Event created, appears in table | ☐ |
| 2.2 | Missing Event Name | Leave name blank, fill others | Error/validation message | ☐ |
| 2.3 | Missing Date | Leave date blank | Error/validation message | ☐ |
| 2.4 | Missing Start Time | Leave start time blank | Error/validation message | ☐ |
| 2.5 | Missing End Time | Leave end time blank | Error/validation message | ☐ |
| 2.6 | Missing Late Until | Leave late until blank | Error/validation message | ☐ |
| 2.7 | Invalid Time Order | Set start=8:30, end=8:00 (end before start) | Error or warning shown | ☐ |
| 2.8 | Late Until Before End Time | Set end=8:30, late_until=8:15 | Error or warning shown | ☐ |
| 2.9 | Load Events Table | Create 5 events, check table loads all | All events display correctly | ☐ |
| 2.10 | Events Sorted | Check if events display in order | Events sorted by date descending | ☐ |

### **Event Status Tracking:**

| # | Test Case | Steps | Expected Result | Status |
|---|-----------|-------|-----------------|--------|
| 2.11 | Upcoming Event Status | Create event for tomorrow | Status = "upcoming" | ☐ |
| 2.12 | Ongoing Event Status | Current time between start & late_until | Status = "ongoing" | ☐ |
| 2.13 | Completed Event Status | Current time after late_until | Status = "completed" | ☐ |
| 2.14 | Status Badge Display | Check status badge colors | Colors match status (upcoming/ongoing/completed) | ☐ |

### **Event Editing:**

| # | Test Case | Steps | Expected Result | Status |
|---|-----------|-------|-----------------|--------|
| 2.15 | Edit Upcoming Event | Click edit on upcoming event | Modal opens with pre-filled data | ☐ |
| 2.16 | Edit Ongoing Event | Click edit on ongoing event | Confirmation dialog appears: "Event is still ONGOING" | ☐ |
| 2.17 | Edit Ongoing - Cancel | Click Cancel in confirmation | Modal closes, event NOT updated | ☐ |
| 2.18 | Edit Ongoing - Confirm | Click OK in confirmation | Modal opens, event can be edited | ☐ |
| 2.19 | Edit Completed Event | Try to click edit button on completed event | No edit button shown, only delete button | ☐ |
| 2.20 | Save Event Edit | Update end time from 8:30 to 9:00 | Event updated, table refreshes | ☐ |
| 2.21 | Verify Edit Applied | Refresh page, check event times | New times saved correctly | ☐ |

### **Event Deletion:**

| # | Test Case | Steps | Expected Result | Status |
|---|-----------|-------|-----------------|--------|
| 2.22 | Delete Upcoming Event | Click delete on upcoming event | Event deleted, removed from table | ☐ |
| 2.23 | Delete Ongoing Event | Click delete on ongoing event | Event deleted (or confirmation shown) | ☐ |
| 2.24 | Delete Completed Event | Click delete on completed event | Event deleted, only delete button available | ☐ |
| 2.25 | Delete Related Records | Delete event, check sanctions table | Related sanctions also deleted | ☐ |

---

## **3. STUDENT ATTENDANCE SCANNING** 📲

### Test Cases:

| # | Test Case | Steps | Expected Result | Status |
|---|-----------|-------|-----------------|--------|
| 3.1 | Select Event | Choose event from dropdown | Event selected, ready for scanning | ☐ |
| 3.2 | No Event Selected | Try to scan without selecting event | Error: "Please select an event" | ☐ |
| 3.3 | Scan During Event | Event time: 8:00-8:30, scan at 8:15 | Status = "present", record created | ☐ |
| 3.4 | Scan Before Event Start | Event starts 8:00, scan at 7:55 | Error: "Too early! Scanning opens at 08:00" | ☐ |
| 3.5 | Scan At Event Start | Scan exactly at 8:00 | Status = "present" ✅ | ☐ |
| 3.6 | Scan Before End Time | Event ends 8:30, scan at 8:20 | Status = "present" ✅ | ☐ |
| 3.7 | Scan At End Time | Scan exactly at 8:30 | Status = "present" ✅ | ☐ |
| 3.8 | Scan Late (within late window) | Event ends 8:30, late_until 8:45, scan at 8:40 | Status = "late", Late sanction created (500 fee) | ☐ |
| 3.9 | Scan After Late Cutoff | Late_until 8:45, scan at 8:50 | Error: "Event is closed (deadline was 08:45). Please contact the officers." | ☐ |
| 3.10 | Duplicate Scan | Student scans twice | 2nd scan rejected: "already scanned (present/late at HH:MM)" | ☐ |

### **RFID Card Issues:**

| # | Test Case | Steps | Expected Result | Status |
|---|-----------|-------|-----------------|--------|
| 3.11 | Unknown RFID | Scan unregistered card | Error: "Unknown card (12345678)" | ☐ |
| 3.12 | Valid Student RFID | Scan registered student card | Student name displayed, attendance recorded | ☐ |
| 3.13 | Empty Scan | Scan nothing (empty input) | No action taken | ☐ |
| 3.14 | Whitespace Scan | Scan with extra spaces | Spaces trimmed, scan processed normally | ☐ |

### **Display & Feedback:**

| # | Test Case | Steps | Expected Result | Status |
|---|-----------|-------|-----------------|--------|
| 3.15 | Success Feedback | Scan valid card | Display shows: "✅ [Name] marked PRESENT" | ☐ |
| 3.16 | Late Feedback | Scan during late window | Display shows: "🟡 [Name] marked LATE" | ☐ |
| 3.17 | Error Feedback | Scan with issue | Display shows appropriate error message | ☐ |
| 3.18 | Real-time Table Update | Scan card, check attendance table | Table updates immediately | ☐ |

---

## **4. SANCTIONS MANAGEMENT** 🚨

### Test Cases:

| # | Test Case | Steps | Expected Result | Status |
|---|-----------|-------|-----------------|--------|
| 4.1 | View All Sanctions | Load sanctions page | All sanctions display in table | ☐ |
| 4.2 | Filter by Event | Select event in filter | Shows only sanctions for that event | ☐ |
| 4.3 | Filter by Section | Select section in filter | Shows only sanctions for that section | ☐ |
| 4.4 | Filter by Team | Select team in filter | Shows only sanctions for that team | ☐ |
| 4.5 | Filter by Year Level | Select year level in filter | Shows only sanctions for that year level | ☐ |
| 4.6 | Multiple Filters | Select event + section + team | Shows intersection of filters | ☐ |
| 4.7 | Late Sanction Created | Scan during late window | Sanction created: Late, 500 fee, pending | ☐ |
| 4.8 | Absent Sanction Created | Auto-absent triggers | Sanction created: Absent, 1500 fee, pending | ☐ |
| 4.9 | Resolve Sanction | Click resolve on pending sanction | Status changes to "resolved" | ☐ |
| 4.10 | Check Resolved Shows | Check "Show Resolved" checkbox | Resolved sanctions now visible | ☐ |

### **Sanction Export:**

| # | Test Case | Steps | Expected Result | Status |
|---|-----------|-------|-----------------|--------|
| 4.11 | Export to CSV | Click export button | CSV file downloads | ☐ |
| 4.12 | CSV Content | Open downloaded CSV | Contains all sanctions data (name, event, penalty, fee, status) | ☐ |

---

## **5. AUTO-ABSENT LOGIC** 🚫

### Test Cases:

| # | Test Case | Steps | Expected Result | Status |
|---|-----------|-------|-----------------|--------|
| 5.1 | Event Completes | Current time passes late_until | Event status changes to "completed" | ☐ |
| 5.2 | Auto-Absent Triggers (Refresh) | Refresh page after event completes | Auto-absent runs, unscanned students marked absent | ☐ |
| 5.3 | Check Absent Records | View attendance for completed event | Unscanned students show status "absent" | ☐ |
| 5.4 | Absent Sanctions Created | Check sanctions after auto-absent | Absent sanctions created (1500 fee) for unscanned students | ☐ |
| 5.5 | Only Unscanned Marked Absent | Some students scanned, some didn't | Only non-scanned students marked absent | ☐ |
| 5.6 | Already Present Not Marked Absent | Student scanned as present | Not marked absent, no duplicate sanction | ☐ |
| 5.7 | Already Late Not Changed | Student scanned as late | Stays late, no change to absent | ☐ |
| 5.8 | Correct Fee Applied | Check absent sanction fee | Fee = 1500 (not 500) | ☐ |

### **Test Case: 1000+ Students (Scale Test):**

| # | Test Case | Steps | Expected Result | Status |
|---|-----------|-------|-----------------|--------|
| 5.9 | Auto-Absent for Many | Create event with 1000+ students, mark ~500 scanned | Auto-absent runs for ~500 unscanned (no timeout) | ☐ |
| 5.10 | Sanctions Created Correctly | Check all 500 absent sanctions created | All 500 records in sanctions table | ☐ |
| 5.11 | No Duplicates | Check if any duplicate sanctions | No duplicate entries | ☐ |

---

## **6. EVENT EXTENSION & RECALCULATION** 🔄

### Test Cases:

| # | Test Case | Steps | Expected Result | Status |
|---|-----------|-------|-----------------|--------|
| 6.1 | Extend End Time | Event originally 8:00-8:30, extend to 9:00 | Event updated, time_end = 9:00 | ☐ |
| 6.2 | Extend Late Until | Event originally late_until 8:45, extend to 9:15 | Event updated, late_until = 9:15 | ☐ |
| 6.3 | Recalculate Present | Student scanned at 8:40 (was late), after extension they're now present | Status recalculated: "late" → "present", late sanction removed | ☐ |
| 6.4 | Recalculate Late | Student scanned at 8:50 (was rejected/absent), after extension they're now late | Status recalculated, late sanction created, absent sanction removed | ☐ |
| 6.5 | Remove Sanctions | Student marked "present" after extension | Pending late/absent sanctions removed | ☐ |
| 6.6 | Add Late Sanction | Student marked "late" after extension | Late sanction created if not exists | ☐ |
| 6.7 | Add Absent Sanction | Student marked "absent" after extension | Absent sanction created if not exists | ☐ |

### **Test Case: Edit with Auto-Absent Already Triggered:**

| # | Test Case | Steps | Expected Result | Status |
|---|-----------|-------|-----------------|--------|
| 6.8 | Edit Completed Event | Event is completed, try to edit | Edit button not shown, only delete button | ☐ |
| 6.9 | Manual Late Until Adjustment | Manually move late_until to future time | UI/sanction updates if applicable | ☐ |

---

## **7. ERROR HANDLING** ⚠️

### Database/Network Errors:

| # | Test Case | Steps | Expected Result | Status |
|---|-----------|-------|-----------------|--------|
| 7.1 | Network Offline (Scan) | Disconnect internet, try to scan | Error message shown, graceful handling | ☐ |
| 7.2 | Network Offline (Create Event) | Disconnect internet, try to create event | Error message shown | ☐ |
| 7.3 | Supabase Connection Error | Simulate connection failure | Error message, no data loss | ☐ |
| 7.4 | Database Query Timeout | Simulate slow database | Loading indicator shown, eventually succeeds or shows error | ☐ |

### Validation Errors:

| # | Test Case | Steps | Expected Result | Status |
|---|-----------|-------|-----------------|--------|
| 7.5 | Invalid Date Format | Enter invalid date | Error message shown | ☐ |
| 7.6 | Invalid Time Format | Enter invalid time | Error message shown | ☐ |
| 7.7 | Future Date for Scan | Select past event for scanning | Works (event record exists in DB) | ☐ |
| 7.8 | Special Characters in Event Name | Event name with symbols: "Test@Event#123" | Event created with special characters intact | ☐ |

### Concurrency Issues:

| # | Test Case | Steps | Expected Result | Status |
|---|-----------|-------|-----------------|--------|
| 7.9 | Duplicate Scan Prevention | Student tries to scan twice simultaneously | 2nd scan rejected with duplicate message | ☐ |
| 7.10 | Delete Event While Scanning | Delete event from admin while student scans | Scan fails with appropriate error | ☐ |
| 7.11 | Edit Event While Scanning | Edit event times while student scans | Scan uses current DB values | ☐ |

---

## **8. EDGE CASES** 🎯

### Time Zone Edge Cases:

| # | Test Case | Steps | Expected Result | Status |
|---|-----------|-------|-----------------|--------|
| 8.1 | Midnight Event | Event start: 23:30, end: 00:30 (next day) | Handles day boundary correctly | ☐ |
| 8.2 | Same Start & End Time | Event: 8:00 start, 8:00 end, 8:15 late_until | Present window = 0 minutes, only late possible | ☐ |
| 8.3 | 1-Second Event | Event: 8:00 start, 8:00:01 end, 8:15 late_until | Works correctly | ☐ |

### Boundary Time Edge Cases:

| # | Test Case | Steps | Expected Result | Status |
|---|-----------|-------|-----------------|--------|
| 8.4 | Scan at Exact Start Time | Scan at exactly time_start | Status = "present" ✅ | ☐ |
| 8.5 | Scan at Exact End Time | Scan at exactly time_end | Status = "present" ✅ (still within present window) | ☐ |
| 8.6 | Scan 1 Second After End Time | Scan 1 second after time_end | Status = "late" (in late window) | ☐ |
| 8.7 | Scan at Exact Late Cutoff | Scan at exactly late_until | Status = "late" ✅ (still within late window) | ☐ |
| 8.8 | Scan 1 Second After Late Cutoff | Scan 1 second after late_until | Rejected: "Event is closed" | ☐ |

### Data Edge Cases:

| # | Test Case | Steps | Expected Result | Status |
|---|-----------|-------|-----------------|--------|
| 8.9 | Student with Multiple Scans (Different Events) | Same student scans in Event A & Event B | Both attendance records created, no conflict | ☐ |
| 8.10 | Student with Late in One Event, Absent in Another | Event A: late, Event B: absent | Separate sanctions for each event | ☐ |
| 8.11 | Event with Zero Attendees | Event completes, nobody scanned | All students marked absent, 1000+ sanctions created | ☐ |
| 8.12 | Event with All Attendees | Event completes, everyone scanned | No absent sanctions, all marked present/late | ☐ |
| 8.13 | Very Long Event Duration | Event start 8:00, late_until 18:00 (10 hours) | System handles large time window | ☐ |
| 8.14 | Event in Past | Select past event for scanning | Behavior depends on event status | ☐ |

### UI/UX Edge Cases:

| # | Test Case | Steps | Expected Result | Status |
|---|-----------|-------|-----------------|--------|
| 8.15 | Very Long Event Name | Event name: 100+ characters | Displays properly without overflow | ☐ |
| 8.16 | Very Long Student Name | Student name: 100+ characters | Displays properly in tables/messages | ☐ |
| 8.17 | Rapid Successive Scans | Scan card 5 times quickly | Each scan processed, duplicates rejected | ☐ |
| 8.18 | Page Refresh During Scan | Refresh admin page while scanning | Graceful handling, no data loss | ☐ |
| 8.19 | Tab Switch During Event | Switch tabs while event running, come back | System still functional, times updated | ☐ |
| 8.20 | Mobile Responsiveness | Access on mobile device | UI responsive, all functions work | ☐ |

---

## **9. WORKFLOW SCENARIOS** 🎬

### Complete Workflow 1: Normal Event

| Step | Action | Expected Result | Status |
|------|--------|-----------------|--------|
| 1 | Admin creates event: "Math Class" (8:00-8:30, late_until 8:45) | Event created, status = "upcoming" | ☐ |
| 2 | At 7:50, student tries to scan | Rejected: "Too early! Scanning opens at 08:00" | ☐ |
| 3 | At 8:10, student scans | Status = "present", attendance recorded | ☐ |
| 4 | At 8:35, another student scans | Status = "late", late sanction created (500 fee) | ☐ |
| 5 | At 8:46, admin refreshes page | Event status = "completed", auto-absent runs | ☐ |
| 6 | Check attendance table | 1 present, 1 late, remaining = absent | ☐ |
| 7 | Check sanctions table | 1 late (500), ~998 absent (1500 each) | ☐ |

### Complete Workflow 2: Event Extension

| Step | Action | Expected Result | Status |
|------|--------|-----------------|--------|
| 1 | Create event: "Physics Lab" (8:00-9:00, late_until 9:15) | Event created | ☐ |
| 2 | Student A scans at 9:10 | Status = "late" (between 9:00 and 9:15) | ☐ |
| 3 | Admin extends end time to 9:30, late_until to 9:45 | Event updated | ☐ |
| 4 | Auto-recalculation runs | Student A now "present" (between 8:00 and 9:30) | ☐ |
| 5 | Check Student A's sanction | Late sanction removed | ☐ |
| 6 | Student B scans at 9:40 | Status = "late" (between 9:30 and 9:45) | ☐ |
| 7 | Late sanction for B created | Fee = 500, status = pending | ☐ |

### Complete Workflow 3: Ongoing Event Edit

| Step | Action | Expected Result | Status |
|------|--------|-----------------|--------|
| 1 | Event "Science Class" running (8:00-8:30, late_until 8:45) | Status = "ongoing" | ☐ |
| 2 | Click edit button at 8:20 | Confirmation dialog: "Event is still ONGOING" | ☐ |
| 3 | Click Cancel | Dialog closes, no changes | ☐ |
| 4 | Click edit again | Confirmation shown again | ☐ |
| 5 | Click OK to proceed | Edit modal opens | ☐ |
| 6 | Change end time to 9:00 | Changes saved | ☐ |
| 7 | Refresh to verify | New time saved in DB | ☐ |

---

## **10. PERFORMANCE TESTS** ⚡

| # | Test Case | Steps | Expected Result | Status |
|---|-----------|-------|-----------------|--------|
| 10.1 | Load with 1000+ Sanctions | Filter sanctions, display table | Loads within reasonable time (<3 sec) | ☐ |
| 10.2 | Export 1000+ Sanctions to CSV | Click export button | CSV generates within reasonable time | ☐ |
| 10.3 | Create Event with 1000+ Students | Event created, attendance page loads | Interface responsive | ☐ |
| 10.4 | Auto-Absent for 1000+ Students | Auto-absent triggers for event | Completes without timeout or errors | ☐ |

---

## **NOTES & OBSERVATIONS:**

```
Session 1:
- _______________________________________________________________
- _______________________________________________________________

Session 2:
- _______________________________________________________________
- _______________________________________________________________

Bugs Found:
1. _______________________________________________________________
   Severity: [Critical/High/Medium/Low]
   Steps to Reproduce: ________________________________________
   Expected: ____________   Actual: ____________

2. _______________________________________________________________
   Severity: [Critical/High/Medium/Low]
   Steps to Reproduce: ________________________________________
   Expected: ____________   Actual: ____________

Additional Comments:
___________________________________________________________________
___________________________________________________________________
```

---

## **SUMMARY**

- **Total Test Cases:** 180+
- **Passed:** _____ / 180+
- **Failed:** _____ / 180+
- **Pass Rate:** _____%

**Overall Status:** ☐ PASS ☐ FAIL ☐ PASS WITH ISSUES

**Signed by:** ________________  
**Date:** ________________

---

