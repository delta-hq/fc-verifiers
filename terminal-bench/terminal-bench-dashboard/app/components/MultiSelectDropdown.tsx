'use client';

import { useState, useRef, useEffect } from 'react';

interface MultiSelectDropdownProps {
  options: readonly string[];
  selectedValues: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  categories?: Record<string, readonly string[]>;
}

export default function MultiSelectDropdown({ 
  options, 
  selectedValues, 
  onChange, 
  placeholder = "Select tasks...",
  categories
}: MultiSelectDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Filter options based on search term
  const filteredOptions = options.filter(option =>
    option.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const toggleOption = (option: string) => {
    if (selectedValues.includes(option)) {
      onChange(selectedValues.filter(val => val !== option));
    } else {
      onChange([...selectedValues, option]);
    }
  };

  const selectCategory = (categoryTasks: readonly string[]) => {
    // Add all tasks from category that aren't already selected
    const newTasks = categoryTasks.filter(task => !selectedValues.includes(task));
    onChange([...selectedValues, ...newTasks]);
  };

  const clearAll = () => {
    onChange([]);
  };

  const selectAll = () => {
    onChange([...filteredOptions]);
  };

  return (
    <div className="multi-select-dropdown" ref={dropdownRef} style={{ position: 'relative' }}>
      {/* Selected values display */}
      <div
        onClick={() => setIsOpen(!isOpen)}
        style={{
          width: '100%',
          minHeight: '2.5rem',
          padding: '0.5rem',
          border: '1px solid #d1d5db',
          borderRadius: '0.375rem',
          fontSize: '1rem',
          color: '#111827',
          backgroundColor: 'white',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '0.25rem'
        }}
      >
        {selectedValues.length === 0 ? (
          <span style={{ color: '#6b7280' }}>{placeholder}</span>
        ) : (
          <>
            {selectedValues.slice(0, 3).map(value => (
              <span
                key={value}
                style={{
                  backgroundColor: '#dbeafe',
                  color: '#1e40af',
                  padding: '0.125rem 0.5rem',
                  borderRadius: '0.25rem',
                  fontSize: '0.875rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.25rem'
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleOption(value);
                }}
              >
                {value}
                <button
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#1e40af',
                    cursor: 'pointer',
                    padding: '0',
                    lineHeight: 1
                  }}
                >
                  ×
                </button>
              </span>
            ))}
            {selectedValues.length > 3 && (
              <span style={{ color: '#6b7280', fontSize: '0.875rem' }}>
                +{selectedValues.length - 3} more
              </span>
            )}
          </>
        )}
        <span style={{ marginLeft: 'auto', color: '#6b7280' }}>
          {isOpen ? '▲' : '▼'}
        </span>
      </div>

      {/* Dropdown content */}
      {isOpen && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            backgroundColor: 'white',
            border: '1px solid #d1d5db',
            borderRadius: '0.375rem',
            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
            zIndex: 50,
            maxHeight: '400px',
            overflow: 'hidden',
            marginTop: '0.25rem'
          }}
        >
          {/* Search input */}
          <div style={{ padding: '0.75rem', borderBottom: '1px solid #e5e7eb' }}>
            <input
              type="text"
              placeholder="Search tasks..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{
                width: '100%',
                padding: '0.5rem',
                border: '1px solid #d1d5db',
                borderRadius: '0.25rem',
                fontSize: '0.875rem',
                outline: 'none'
              }}
              onClick={(e) => e.stopPropagation()}
            />
          </div>

          {/* Action buttons */}
          <div style={{ 
            padding: '0.5rem', 
            borderBottom: '1px solid #e5e7eb',
            display: 'flex',
            gap: '0.5rem'
          }}>
            <button
              onClick={selectAll}
              style={{
                padding: '0.25rem 0.5rem',
                backgroundColor: '#f3f4f6',
                border: '1px solid #d1d5db',
                borderRadius: '0.25rem',
                fontSize: '0.75rem',
                cursor: 'pointer'
              }}
            >
              Select All
            </button>
            <button
              onClick={clearAll}
              style={{
                padding: '0.25rem 0.5rem',
                backgroundColor: '#fef2f2',
                border: '1px solid #fecaca',
                borderRadius: '0.25rem',
                fontSize: '0.75rem',
                cursor: 'pointer',
                color: '#dc2626'
              }}
            >
              Clear All
            </button>
          </div>

          {/* Categories */}
          {categories && (
            <div style={{ padding: '0.5rem', borderBottom: '1px solid #e5e7eb' }}>
              <div style={{ fontSize: '0.75rem', fontWeight: '600', color: '#6b7280', marginBottom: '0.5rem' }}>
                Quick Select Categories:
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
                {Object.entries(categories).map(([categoryName, categoryTasks]) => (
                  <button
                    key={categoryName}
                    onClick={() => selectCategory(categoryTasks)}
                    style={{
                      padding: '0.25rem 0.5rem',
                      backgroundColor: '#eff6ff',
                      border: '1px solid #bfdbfe',
                      borderRadius: '0.25rem',
                      fontSize: '0.75rem',
                      cursor: 'pointer',
                      color: '#1d4ed8'
                    }}
                  >
                    {categoryName}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Options list */}
          <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
            {filteredOptions.length === 0 ? (
              <div style={{ padding: '1rem', color: '#6b7280', textAlign: 'center' }}>
                No tasks found
              </div>
            ) : (
              filteredOptions.map(option => (
                <div
                  key={option}
                  onClick={() => toggleOption(option)}
                  style={{
                    padding: '0.75rem',
                    cursor: 'pointer',
                    backgroundColor: selectedValues.includes(option) ? '#dbeafe' : 'transparent',
                    borderBottom: '1px solid #f3f4f6',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    fontSize: '0.875rem'
                  }}
                  onMouseEnter={(e) => {
                    if (!selectedValues.includes(option)) {
                      (e.target as HTMLElement).style.backgroundColor = '#f9fafb';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!selectedValues.includes(option)) {
                      (e.target as HTMLElement).style.backgroundColor = 'transparent';
                    }
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selectedValues.includes(option)}
                    readOnly
                    style={{ margin: 0 }}
                  />
                  <span style={{ fontFamily: 'monospace' }}>{option}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}