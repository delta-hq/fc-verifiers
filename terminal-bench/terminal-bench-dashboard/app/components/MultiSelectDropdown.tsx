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
          minHeight: '2rem',
          padding: '0.25rem',
          border: '1px solid #30363d',
          backgroundColor: '#161b22',
          color: '#c9d1d9',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '0.25rem',
          fontFamily: 'Monaco, monospace',
          fontSize: '12px'
        }}
      >
        {selectedValues.length === 0 ? (
          <span style={{ color: '#6e7681' }}>{placeholder}</span>
        ) : (
          <>
            {selectedValues.slice(0, 2).map(value => (
              <span
                key={value}
                style={{
                  backgroundColor: '#1f6feb',
                  color: '#ffffff',
                  border: '1px solid #1f6feb',
                  padding: '0 0.25rem',
                  fontSize: '11px',
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
                    color: '#ffffff',
                    cursor: 'pointer',
                    padding: '0',
                    lineHeight: 1,
                    fontFamily: 'inherit'
                  }}
                >
                  x
                </button>
              </span>
            ))}
            {selectedValues.length > 2 && (
              <span style={{ color: '#6e7681', fontSize: '11px' }}>
                +{selectedValues.length - 2} more
              </span>
            )}
          </>
        )}
        <span style={{ marginLeft: 'auto', color: '#8b949e' }}>
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
            backgroundColor: '#0d1117',
            border: '1px solid #30363d',
            zIndex: 50,
            maxHeight: '400px',
            overflow: 'hidden',
            marginTop: '2px'
          }}
        >
          {/* Search input */}
          <div style={{ padding: '0.5rem', borderBottom: '1px solid #30363d' }}>
            <input
              type="text"
              placeholder="Search..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{
                width: '100%',
                padding: '0.25rem',
                border: '1px solid #30363d',
                backgroundColor: '#161b22',
                color: '#c9d1d9',
                fontSize: '12px',
                outline: 'none',
                fontFamily: 'Monaco, monospace'
              }}
              onClick={(e) => e.stopPropagation()}
            />
          </div>

          {/* Action buttons */}
          <div style={{ 
            padding: '0.25rem', 
            borderBottom: '1px solid #30363d',
            display: 'flex',
            gap: '0.25rem'
          }}>
            <button
              onClick={selectAll}
              style={{
                padding: '0.125rem 0.25rem',
                backgroundColor: '#161b22',
                border: '1px solid #30363d',
                color: '#58a6ff',
                fontSize: '11px',
                cursor: 'pointer',
                fontFamily: 'Monaco, monospace'
              }}
            >
              [ALL]
            </button>
            <button
              onClick={clearAll}
              style={{
                padding: '0.125rem 0.25rem',
                backgroundColor: '#161b22',
                border: '1px solid #da3633',
                color: '#da3633',
                fontSize: '11px',
                cursor: 'pointer',
                fontFamily: 'Monaco, monospace'
              }}
            >
              [CLEAR]
            </button>
          </div>

          {/* Categories */}
          {categories && (
            <div style={{ padding: '0.25rem', borderBottom: '1px solid #30363d' }}>
              <div style={{ fontSize: '11px', color: '#79c0ff', marginBottom: '0.25rem' }}>
                CATEGORIES:
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
                {Object.entries(categories).map(([categoryName, categoryTasks]) => (
                  <button
                    key={categoryName}
                    onClick={() => selectCategory(categoryTasks)}
                    style={{
                      padding: '0 0.25rem',
                      backgroundColor: '#161b22',
                      border: '1px solid #30363d',
                      color: '#8b949e',
                      fontSize: '11px',
                      cursor: 'pointer',
                      fontFamily: 'Monaco, monospace'
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
              <div style={{ padding: '0.5rem', color: '#6e7681', textAlign: 'center', fontSize: '12px' }}>
                No tasks found
              </div>
            ) : (
              filteredOptions.map(option => (
                <div
                  key={option}
                  onClick={() => toggleOption(option)}
                  style={{
                    padding: '0.25rem 0.5rem',
                    cursor: 'pointer',
                    backgroundColor: selectedValues.includes(option) ? '#161b22' : '#0d1117',
                    borderBottom: '1px solid #21262d',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    fontSize: '12px',
                    fontFamily: 'Monaco, monospace',
                    color: selectedValues.includes(option) ? '#58a6ff' : '#c9d1d9'
                  }}
                  onMouseEnter={(e) => {
                    if (!selectedValues.includes(option)) {
                      (e.target as HTMLElement).style.backgroundColor = '#161b22';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!selectedValues.includes(option)) {
                      (e.target as HTMLElement).style.backgroundColor = '#0d1117';
                    }
                  }}
                >
                  <span style={{ 
                    color: selectedValues.includes(option) ? '#58a6ff' : '#6e7681',
                    fontFamily: 'Monaco, monospace'
                  }}>
                    [{selectedValues.includes(option) ? 'X' : ' '}]
                  </span>
                  <span>{option}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}